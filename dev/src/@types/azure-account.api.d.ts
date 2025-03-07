/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SubscriptionModels } from '@azure/arm-subscriptions';
import { TokenCredential } from '@azure/core-auth';
import { Environment } from '@azure/ms-rest-azure-env';
import { TokenCredentialsBase } from '@azure/ms-rest-nodeauth';
import { ReadStream } from 'fs';
import { CancellationToken, Event, Progress, Terminal } from 'vscode';
import { TestCredentials } from '../TestCredentials';

export type AzureLoginStatus = 'Initializing' | 'LoggingIn' | 'LoggedIn' | 'LoggedOut';

export interface AzureAccountExtensionApi {
    readonly status: AzureLoginStatus;
    readonly onStatusChanged: Event<AzureLoginStatus>;
    readonly waitForLogin: () => Promise<boolean>;
    readonly sessions: AzureSession[];
    readonly onSessionsChanged: Event<void>;
    readonly subscriptions: AzureSubscription[];
    readonly onSubscriptionsChanged: Event<void>;
    readonly waitForSubscriptions: () => Promise<boolean>;
    readonly filters: AzureResourceFilter[];
    readonly onFiltersChanged: Event<void>;
    readonly waitForFilters: () => Promise<boolean>;
}

export interface AzureSession {
    readonly environment: Environment;
    readonly userId: string;
    readonly tenantId: string;

    /**
     * The credentials object for azure-sdk-for-js modules https://github.com/azure/azure-sdk-for-js
     */
    readonly credentials2: TestCredentials;
}

export interface AzureSubscription {
    readonly session: AzureSession;
    readonly subscription: SubscriptionModels.Subscription;
}

export type AzureResourceFilter = AzureSubscription;

export type CloudShellStatus = 'Connecting' | 'Connected' | 'Disconnected';

export interface UploadOptions {
    contentLength?: number;
    progress?: Progress<{ message?: string; increment?: number }>;
    token?: CancellationToken;
}

export interface CloudShell {
    readonly status: CloudShellStatus;
    readonly onStatusChanged: Event<CloudShellStatus>;
    readonly waitForConnection: () => Promise<boolean>;
    readonly terminal: Promise<Terminal>;
    readonly session: Promise<AzureSession>;
    readonly uploadFile: (filename: string, stream: ReadStream, options?: UploadOptions) => Promise<void>;
}
