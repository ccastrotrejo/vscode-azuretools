/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { User } from '@azure/arm-appservice';
import { BasicAuthenticationCredentials, HttpOperationResponse, RestError, ServiceClient } from '@azure/ms-rest-js';
import { createGenericClient } from '@microsoft/vscode-azext-azureutils';
import { IActionContext, IParsedError, nonNullProp, parseError, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { createServer, Server, Socket } from 'net';
import { CancellationToken, Disposable } from 'vscode';
import * as ws from 'ws';
import { ext } from './extensionVariables';
import { localize } from './localize';
import { ParsedSite } from './SiteClient';
import { delay } from './utils/delay';

/**
 * Interface for tunnel GetStatus API
 */
enum AppState {
    STARTED = 'STARTED',
    STARTING = 'STARTING',
    STOPPED = 'STOPPED'
}

interface ITunnelStatus {
    port: number;
    canReachPort: boolean;
    state: AppState;
    msg: string;
}

/**
 * Internal error indicating that we should continue to retry getting the tunnel status
 */
class RetryableTunnelStatusError extends Error { }

/**
 * A local TCP server that forwards all connections to the Kudu tunnel websocket endpoint.
 */
export class TunnelProxy {
    private _port: number;
    private _site: ParsedSite;
    private _publishCredential: User;
    private _server: Server;
    private _openSockets: ws.WebSocket[];
    private _isSsh: boolean;

    constructor(port: number, site: ParsedSite, publishCredential: User, isSsh: boolean = false) {
        this._port = port;
        this._site = site;
        this._publishCredential = publishCredential;
        this._server = createServer();
        this._openSockets = [];
        this._isSsh = isSsh;
    }

    public async startProxy(context: IActionContext, token: CancellationToken): Promise<void> {
        try {
            await this.checkTunnelStatusWithRetry(context, token);
            await this.setupTunnelServer(token);
        } catch (error) {
            this.dispose();
            throw error;
        }
    }

    public dispose(): void {
        this._openSockets.forEach((tunnelSocket: ws.WebSocket) => {
            tunnelSocket.close();
        });
        this._server.close();
        this._server.unref();
    }

    /**
     * Ensures the site is up and running (Even if the state is technically "Running", Azure doesn't always keep a site fully "up" if no one has hit the url in a while)
     */
    private async pingApp(context: IActionContext): Promise<void> {
        ext.outputChannel.appendLog('[Tunnel] Pinging app default url...');
        const client: ServiceClient = await createGenericClient(context, undefined);
        let statusCode: number | undefined;
        try {
            const response: HttpOperationResponse = await client.sendRequest({ method: 'GET', url: this._site.defaultHostUrl });
            statusCode = response.status;
        } catch (error) {
            if (error instanceof RestError) {
                statusCode = error.statusCode;
            } else {
                throw error;
            }
        }
        ext.outputChannel.appendLog(`[Tunnel] Ping responded with status code: ${statusCode}`);
    }

    private async checkTunnelStatus(context: IActionContext): Promise<void> {
        const publishingUserName: string = nonNullProp(this._publishCredential, 'publishingUserName');
        const password: string = nonNullProp(this._publishCredential, 'publishingPassword');
        const client: ServiceClient = await createGenericClient(context, new BasicAuthenticationCredentials(publishingUserName, password));

        let tunnelStatus: ITunnelStatus;
        try {
            const response: HttpOperationResponse = await client.sendRequest({
                method: 'GET',
                url: `https://${this._site.kuduHostName}/AppServiceTunnel/Tunnel.ashx?GetStatus&GetStatusAPIVer=2`
            });
            ext.outputChannel.appendLog(`[Tunnel] Checking status, body: ${response.bodyAsText}`);
            tunnelStatus = <ITunnelStatus>response.parsedBody;
        } catch (error) {
            const parsedError: IParsedError = parseError(error);
            ext.outputChannel.appendLog(`[Tunnel] Checking status, error: ${parsedError.message}`);
            throw new Error(localize('tunnelStatusError', 'Error getting tunnel status: {0}', parsedError.errorType));
        }

        if (tunnelStatus.state === AppState.STARTED) {
            if ((tunnelStatus.port === 2222 && !this._isSsh) || (tunnelStatus.port !== 2222 && this._isSsh)) {
                // Tunnel is pointed to default SSH port and still needs time to restart
                throw new RetryableTunnelStatusError();
            } else if (tunnelStatus.canReachPort) {
                return;
            } else {
                throw new Error(localize('tunnelUnreachable', 'App is started, but port is unreachable'));
            }
        } else if (tunnelStatus.state === AppState.STARTING) {
            throw new RetryableTunnelStatusError();
        } else if (tunnelStatus.state === AppState.STOPPED) {
            await this.pingApp(context);
            throw new RetryableTunnelStatusError();
        } else {
            throw new Error(localize('tunnelStatusError', 'Unexpected app state: {0}', tunnelStatus.state));
        }
    }

    private async checkTunnelStatusWithRetry(context: IActionContext, token: CancellationToken): Promise<void> {
        const timeoutSeconds: number = 240; // 4 minutes, matches App Service internal timeout for starting up an app
        const timeoutMs: number = timeoutSeconds * 1000;
        const pollingIntervalMs: number = 5000;

        const start: number = Date.now();
        while (Date.now() < start + timeoutMs) {
            if (token.isCancellationRequested) {
                throw new UserCancelledError('checkTunnelStatus');
            }

            await this.pingApp(context);
            try {
                await this.checkTunnelStatus(context);
                return;
            } catch (error) {
                if (!(error instanceof RetryableTunnelStatusError)) {
                    throw new Error(localize('tunnelFailed', 'Unable to establish connection to application: {0}', parseError(error).message));
                } // else allow retry
            }

            await delay(pollingIntervalMs);
        }
        throw new Error(localize('tunnelTimedOut', 'Unable to establish connection to application: Timed out'));
    }

    private async setupTunnelServer(token: CancellationToken): Promise<void> {
        return new Promise<void>((resolve: () => void, reject: (err: Error) => void): void => {
            const listener: Disposable = token.onCancellationRequested(() => {
                reject(new UserCancelledError('setupTunnelServer'));
                listener.dispose();
            });

            this._server.on('connection', (socket: Socket) => {
                socket.pause(); // Pause while making the connection
                const tunnelSocket: ws.WebSocket = new ws.WebSocket(
                    `wss://${this._site.kuduHostName}/AppServiceTunnel/Tunnel.ashx`,
                    {
                        headers: {
                            'User-Agent': 'vscode-azuretools',
                            'Cache-Control': 'no-cache',
                            Pragma: 'no-cache'
                        },
                        auth: `${this._publishCredential.publishingUserName}:${this._publishCredential.publishingPassword}`,
                    }
                );
                this._openSockets.push(tunnelSocket);

                tunnelSocket.on('open', () => {
                    socket.resume(); // Resume, now that connection is made
                });

                tunnelSocket.on('close', () => {
                    const index: number = this._openSockets.indexOf(tunnelSocket);
                    if (index >= 0) {
                        this._openSockets.splice(index, 1);
                        ext.outputChannel.appendLog(`[Proxy Server] client closed, connection count: ${this._openSockets.length}`);
                    }
                });

                // Tie up the input/output streams
                const duplexStream = ws.createWebSocketStream(tunnelSocket);
                duplexStream.pipe(socket);
                socket.pipe(duplexStream);

                ext.outputChannel.appendLog(`[Proxy Server] client connected ${socket.remoteAddress}:${socket.remotePort}, connection count: ${this._openSockets.length}`);
            });

            this._server.on('listening', () => {
                ext.outputChannel.appendLog('[Proxy Server] start listening');
                resolve();
            });

            this._server.on('error', (err: Error) => {
                ext.outputChannel.appendLog(`[Proxy Server] server error: ${err}`);
                this.dispose();
                reject(err);
            });

            this._server.listen({
                host: 'localhost',
                port: this._port,
                backlog: 1
            });
        });
    }
}
