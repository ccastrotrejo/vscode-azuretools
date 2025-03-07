/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AppServicePlan } from '@azure/arm-appservice';
import { ParsedSite } from '../SiteClient';
import { publisherName } from '../constants';
import { IDeployContext } from './IDeployContext';
import { delayFirstWebAppDeploy } from './delayFirstWebAppDeploy';
import { runWithZipStream } from './runWithZipStream';
import { waitForDeploymentToComplete } from './waitForDeploymentToComplete';

export async function deployZip(context: IDeployContext, site: ParsedSite, fsPath: string, aspPromise: Promise<AppServicePlan | undefined>, pathFileMap?: Map<string, string>): Promise<void> {
    const kuduClient = await site.createClient(context);

    const response = await runWithZipStream(context, {
        fsPath, site, pathFileMap,
        callback: async zipStream => {
            return await kuduClient.zipPushDeploy(context, () => zipStream, {
                author: publisherName,
                deployer: publisherName,
                isAsync: true,
                trackDeploymentId: true
            });
        }
    });
    let locationUrl: string | undefined;
    try {
        if (response) {
            context.telemetry.properties.deploymentId = response.headers.get('scm-deployment-id');
            locationUrl = response.headers.get('location');
        }
    } catch (e) {
        // swallow errors, we don't want a failure here to block deployment
    }

    await waitForDeploymentToComplete(context, site, { locationUrl });

    // https://github.com/Microsoft/vscode-azureappservice/issues/644
    // This delay is a temporary stopgap that should be resolved with the new pipelines
    await delayFirstWebAppDeploy(context, site, aspPromise);
}
