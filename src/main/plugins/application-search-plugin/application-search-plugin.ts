import { SearchPlugin } from "../../search-plugin";
import { SearchResultItem } from "../../../common/search-result-item";
import { ApplicationRepository } from "./application-repository";
import { PluginType } from "../../plugin-type";
import { Application } from "./application";
import { UserConfigOptions } from "../../../common/config/user-config-options";
import { ApplicationSearchOptions } from "./application-search-options";
import { IconType } from "../../../common/icon/icon-type";
import { AutoCompletionResult } from "../../../common/auto-completion-result";
import { createFilePathDescription } from "../../helpers/file-path-helpers";
import { OpenLocationPlugin } from "../../open-location-plugin";

export class ApplicationSearchPlugin implements SearchPlugin, OpenLocationPlugin {
    public readonly pluginType = PluginType.ApplicationSearchPlugin;
    private config: ApplicationSearchOptions;
    private readonly applicationRepository: ApplicationRepository;
    private readonly executeApplication: (executionArgument: string, privileged?: boolean) => Promise<void>;
    private readonly openApplicationLocation: (filePath: string) => Promise<void>;

    constructor(config: ApplicationSearchOptions,
                applicationRepository: ApplicationRepository,
                executeApplication: (executionArgument: string, privileged: boolean) => Promise<void>,
                openApplicationLocation: (filePath: string) => Promise<void>) {
        this.config = config;
        this.applicationRepository = applicationRepository;
        this.executeApplication = executeApplication;
        this.openApplicationLocation = openApplicationLocation;
    }

    public getAll(): Promise<SearchResultItem[]> {
        return new Promise((resolve, reject) => {
            if (!this.isEnabled()) {
                resolve();
            } else {
                this.applicationRepository.getAll()
                .then((applications) => {
                    const searchResultItemPromises = applications.map((application) => this.createSearchResultItemFromApplication(application));
                    Promise.all(searchResultItemPromises)
                        .then((searchResultItems) => resolve(searchResultItems))
                        .catch((err) => reject(err));
                })
                .catch((err) => reject(err));
            }
        });
    }

    public execute(searchResultItem: SearchResultItem, privileged: boolean): Promise<void> {
        return new Promise((resolve, reject) => {
            this.executeApplication(searchResultItem.executionArgument, privileged)
                .then(() => resolve())
                .catch((err) => reject(err));
        });
    }

    public openLocation(searchResultItem: SearchResultItem): Promise<void> {
        return new Promise((resolve, reject) => {
            this.openApplicationLocation(searchResultItem.executionArgument)
                .then(() => resolve())
                .catch((err) => reject(err));
        });
    }

    public autoComplete(searchResultItem: SearchResultItem): Promise<AutoCompletionResult> {
        return new Promise((resolve, reject) => {
            reject("Autocompletion not supported");
        });
    }

    public refreshIndex(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.isEnabled()) {
                resolve();
            } else {
                this.applicationRepository.refreshIndex()
                    .then(() => resolve())
                    .catch((err) => reject(err));
            }
        });
    }

    public clearCache(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.applicationRepository.clearCache()
                .then(() => resolve())
                .catch((err) => reject(`Error while trying to clear application repository cache: ${err}`));
        });
    }

    public updateConfig(config: UserConfigOptions): Promise<void> {
        return new Promise((resolve, reject) => {
            this.config = config.applicationSearchOptions;
            this.applicationRepository.updateConfig(config.applicationSearchOptions)
                .then(() => resolve())
                .catch((err) => reject(err));
        });
    }

    public isEnabled(): boolean {
        return this.config.enabled;
    }

    private createSearchResultItemFromApplication(application: Application): Promise<SearchResultItem> {
        return new Promise((resolve) => {
            resolve({
                description: createFilePathDescription(application.filePath, {
                    showFullFilePath: this.config.showFullFilePath,
                }),
                executionArgument: application.filePath,
                hideMainWindowAfterExecution: true,
                icon: {
                    parameter: application.icon,
                    type: IconType.URL,
                },
                name: application.name,
                originPluginType: this.pluginType,
                searchable: [application.name],
                supportsOpenLocation: true,
            });
        });
    }
}
