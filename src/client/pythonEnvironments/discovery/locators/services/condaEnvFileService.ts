// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * This file is essential to have for us to discover conda interpreters, `CondaEnvService` alone is not sufficient.
 * CondaEnvService runs `<path/to/conda> env list` command, which requires that we know the path to conda.
 * In cases where we're not able to figure that out, we can still use this file to discover paths to conda environments.
 * More details: https://github.com/microsoft/vscode-python/issues/8886
 */

import { inject, injectable } from 'inversify';
import * as path from 'path';
import { Uri } from 'vscode';
import { traceError } from '../../../../common/logger';
import { IFileSystem } from '../../../../common/platform/types';
import { ICondaLocatorService, IInterpreterHelper } from '../../../../interpreter/contracts';
import { IServiceContainer } from '../../../../ioc/types';
import { EnvironmentType, PythonEnvironment } from '../../../info';
import { CacheableLocatorService } from './cacheableLocatorService';
import { AnacondaCompanyName } from '../../../common/environmentManagers/conda';

/**
 * Locate conda env interpreters based on the "conda environments file".
 */
@injectable()
export class CondaEnvFileService extends CacheableLocatorService {
    constructor(
        @inject(IInterpreterHelper) private helperService: IInterpreterHelper,
        @inject(ICondaLocatorService) private condaService: ICondaLocatorService,
        @inject(IFileSystem) private fileSystem: IFileSystem,
        @inject(IServiceContainer) serviceContainer: IServiceContainer,
    ) {
        super('CondaEnvFileService', serviceContainer);
    }

    /**
     * Release any held resources.
     *
     * Called by VS Code to indicate it is done with the resource.
     */

    public dispose(): void {
        // No body
    }

    /**
     * Return the located interpreters.
     *
     * This is used by CacheableLocatorService.getInterpreters().
     */
    protected getInterpretersImplementation(_resource?: Uri): Promise<PythonEnvironment[]> {
        return this.getSuggestionsFromConda();
    }

    /**
     * Return the list of interpreters identified by the "conda environments file".
     */
    private async getSuggestionsFromConda(): Promise<PythonEnvironment[]> {
        if (!this.condaService.condaEnvironmentsFile) {
            return [];
        }
        return this.fileSystem
            .fileExists(this.condaService.condaEnvironmentsFile!)
            .then((exists) =>
                exists ? this.getEnvironmentsFromFile(this.condaService.condaEnvironmentsFile!) : Promise.resolve([]),
            );
    }

    /**
     * Return the list of environments identified in the given file.
     */
    private async getEnvironmentsFromFile(envFile: string) {
        try {
            const fileContents = await this.fileSystem.readFile(envFile);
            const environmentPaths = fileContents
                .split(/\r?\n/g)
                .map((environmentPath) => environmentPath.trim())
                .filter((environmentPath) => environmentPath.length > 0);

            const interpreters = (
                await Promise.all(
                    environmentPaths.map((environmentPath) => this.getInterpreterDetails(environmentPath)),
                )
            )
                .filter((item) => !!item)
                .map((item) => item!);

            const environments = await this.condaService.getCondaEnvironments(true);
            if (Array.isArray(environments) && environments.length > 0) {
                interpreters.forEach((interpreter) => {
                    const environment = environments.find((item) =>
                        this.fileSystem.arePathsSame(item.path, interpreter!.envPath!),
                    );
                    if (environment) {
                        interpreter.envName = environment!.name;
                    }
                });
            }
            return interpreters;
        } catch (err) {
            traceError('Python Extension (getEnvironmentsFromFile.readFile):', err);
            // Ignore errors in reading the file.
            return [] as PythonEnvironment[];
        }
    }

    /**
     * Return the interpreter info for the given anaconda environment.
     */
    private async getInterpreterDetails(environmentPath: string): Promise<PythonEnvironment | undefined> {
        const interpreter = this.condaService.getInterpreterPath(environmentPath);
        if (!interpreter || !(await this.fileSystem.fileExists(interpreter))) {
            return undefined;
        }

        const details = await this.helperService.getInterpreterInformation(interpreter);
        if (!details) {
            return undefined;
        }
        const envName = details.envName ? details.envName : path.basename(environmentPath);
        this._hasInterpreters.resolve(true);
        return {
            ...(details as PythonEnvironment),
            path: interpreter,
            companyDisplayName: AnacondaCompanyName,
            envType: EnvironmentType.Conda,
            envPath: environmentPath,
            envName,
        };
    }
}
