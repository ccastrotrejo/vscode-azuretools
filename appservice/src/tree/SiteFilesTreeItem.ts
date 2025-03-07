/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, createContextValue } from '@microsoft/vscode-azext-utils';
import { localize } from '../localize';
import { ParsedSite } from '../SiteClient';
import { FolderTreeItem } from './FolderTreeItem';

interface SiteFilesTreeItemOptions {
    site: ParsedSite;
    isReadOnly: boolean;
    contextValuesToAdd?: string[];
}

export class SiteFilesTreeItem extends FolderTreeItem {
    public static contextValue: string = 'siteFiles';
    public suppressMaskLabel: boolean = true;

    public readonly contextValuesToAdd: string[];

    protected readonly _isRoot: boolean = true;

    constructor(parent: AzExtParentTreeItem, options: SiteFilesTreeItemOptions) {
        super(parent, {
            site: options.site,
            label: localize('siteFiles', 'Files'),
            path: '/site/wwwroot',
            isReadOnly: options.isReadOnly
        });
        this.contextValuesToAdd = options.contextValuesToAdd || [];
    }

    public get contextValue(): string {
        return createContextValue([SiteFilesTreeItem.contextValue, ...this.contextValuesToAdd]);
    }
}
