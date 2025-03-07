/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands, Uri } from 'vscode';
import * as types from '../index';
import { callWithTelemetryAndErrorHandling } from './callWithTelemetryAndErrorHandling';
import { ext } from './extensionVariables';
import { addTreeItemValuesToMask } from './tree/addTreeItemValuesToMask';
import { AzExtTreeItem } from './tree/AzExtTreeItem';

export function registerCommand(commandId: string, callback: (context: types.IActionContext, ...args: unknown[]) => unknown, debounce?: number, telemetryId?: string): void {
    let lastClickTime: number | undefined; /* Used for debounce */
    ext.context.subscriptions.push(commands.registerCommand(commandId, async (...args: unknown[]): Promise<unknown> => {
        if (debounce) { /* Only check for debounce if registered command specifies */
            if (debounceCommand(debounce, lastClickTime)) {
                return;
            }
            lastClickTime = Date.now();
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return await callWithTelemetryAndErrorHandling(
            telemetryId || commandId,
            (context: types.IActionContext) => {
                if (args.length > 0) {
                    const firstArg: unknown = args[0];

                    if (firstArg instanceof AzExtTreeItem) {
                        context.telemetry.properties.contextValue = firstArg.contextValue;
                    } else if (firstArg instanceof Uri) {
                        context.telemetry.properties.contextValue = 'Uri';
                    }

                    for (const arg of args) {
                        if (arg instanceof AzExtTreeItem) {
                            addTreeItemValuesToMask(context, arg, 'command');
                        }
                    }
                }

                // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                return callback(context, ...args);
            }
        );
    }));
}

function debounceCommand(debounce: number, lastClickTime?: number): boolean {
    if (lastClickTime && lastClickTime + debounce > Date.now()) {
        return true;
    }
    return false;
}
