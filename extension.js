// Import necessary modules from Node.js and third-party libraries
const vscode = require('vscode');
const { Octokit } = require('@octokit/rest');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Declare variables for Octokit instance and extension context
let octokit;
let extensionContext;

/**
 * Detects the environment in which the extension is running.
 * Checks for WindSurf-specific environment variables or paths.
 * @returns {Object} An object containing environment details.
 */
function detectEnvironment() {
    // Check for WindSurf-specific environment variables or paths
    const isWindsurf = process.env.WINDSURF_APP === 'true' || 
                      process.execPath.toLowerCase().includes('windsurf') ||
                      vscode.env.appName.toLowerCase().includes('windsurf');
    
    return {
        isWindsurf,
        platform: process.platform,
        architecture: process.arch,
        appName: vscode.env.appName,
        appHost: vscode.env.appHost
    };
}

/**
 * Determines the path to the VS Code settings file based on the OS.
 * @returns {string} The path to the settings.json file.
 */
function getSettingsPath() {
    // Get the environment details
    const env = detectEnvironment();
    const home = os.homedir();
    const appFolder = env.isWindsurf ? 'windsurf' : 'Code';
    
    let basePath;
    // Determine the base path based on the OS
    switch (process.platform) {
        case 'win32':
            basePath = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
            return path.join(basePath, appFolder, 'User', 'settings.json');
            
        case 'darwin':
            basePath = path.join(home, 'Library', 'Application Support');
            return path.join(basePath, appFolder, 'User', 'settings.json');
            
        case 'linux':
            basePath = path.join(home, '.config');
            return path.join(basePath, appFolder, 'User', 'settings.json');
            
        default:
            throw new Error(`Unsupported platform: ${process.platform}`);
    }
}

/**
 * Ensures that the directory for a given file path exists.
 * Creates the directory if it does not exist.
 * @param {string} filePath - The path to the file.
 */
async function ensureDirectoryExists(filePath) {
    try {
        // Create the directory recursively if it does not exist
        await fs.mkdir(path.dirname(filePath), { recursive: true });
    } catch (error) {
        // Ignore the error if the directory already exists
        if (error.code !== 'EEXIST') {
            throw error;
        }
    }
}

/**
 * Reads and parses the settings file, returning its contents as an object.
 * Returns an empty object if the file does not exist.
 * @param {string} filePath - The path to the settings file.
 * @returns {Object} The parsed settings object.
 */
async function readSettingsFile(filePath) {
    try {
        // Ensure the directory exists before reading the file
        await ensureDirectoryExists(filePath);
        const content = await fs.readFile(filePath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        // Return an empty object if the file does not exist
        if (error.code === 'ENOENT') {
            return {};
        }
        throw error;
    }
}

/**
 * Writes the provided settings object to the specified file path.
 * Ensures the directory exists before writing.
 * @param {string} filePath - The path to the settings file.
 * @param {Object} settings - The settings object to write.
 */
async function writeSettingsFile(filePath, settings) {
    // Ensure the directory exists before writing
    await ensureDirectoryExists(filePath);
    await fs.writeFile(filePath, JSON.stringify(settings, null, 4), 'utf8');
}

/**
 * Activates the extension, registering commands and logging environment info.
 * @param {vscode.ExtensionContext} context - The extension context.
 */
async function activate(context) {
    console.log('VS Code Settings Sync is now active!');
    extensionContext = context;

    // Log environment information
    const env = detectEnvironment();
    console.log('Environment:', env);

    // Register the sync command
    let syncCommand = vscode.commands.registerCommand('vscode-settings-sync.sync', async () => {
        try {
            await syncSettings();
        } catch (error) {
            vscode.window.showErrorMessage(`Sync failed: ${error.message}`);
        }
    });

    // Register the configure command
    let configureCommand = vscode.commands.registerCommand('vscode-settings-sync.configure', async () => {
        await configureGitHub();
    });

    // Add the commands to the extension context
    context.subscriptions.push(syncCommand, configureCommand);
}

/**
 * Configures the GitHub token for the extension.
 */
async function configureGitHub() {
    // Prompt the user for their GitHub Personal Access Token
    const token = await vscode.window.showInputBox({
        prompt: 'Enter your GitHub Personal Access Token',
        password: true,
        placeHolder: 'ghp_xxxxxxxxxxxxxxxx',
        validateInput: text => {
            return text && text.length >= 40 ? null : 'Token should be at least 40 characters long';
        }
    });

    if (token) {
        try {
            // Store the token securely
            await extensionContext.secrets.store('github-token', token);
            octokit = new Octokit({ auth: token });
            
            // Verify the token
            await octokit.users.getAuthenticated();
            
            vscode.window.showInformationMessage('GitHub configuration saved and verified!');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to verify GitHub token: ${error.message}`);
        }
    }
}

/**
 * Syncs the VS Code settings with the GitHub repository.
 */
async function syncSettings() {
    // Get the GitHub token
    const token = await extensionContext.secrets.get('github-token');
    if (!token) {
        vscode.window.showErrorMessage('Please configure GitHub token first');
        return;
    }

    // Initialize the Octokit instance
    octokit = new Octokit({ auth: token });

    try {
        // Get the gist ID from the extension context
        const gistId = await extensionContext.globalState.get('settingsSyncGistId');
        const settingsPath = getSettingsPath();
        const env = detectEnvironment();
        
        if (gistId) {
            // Prompt the user to choose the sync direction
            const choice = await vscode.window.showQuickPick(
                [
                    {
                        label: 'Download from GitHub',
                        description: `Override ${env.isWindsurf ? 'WindSurf' : 'VS Code'} settings with GitHub version`
                    },
                    {
                        label: 'Upload to GitHub',
                        description: `Override GitHub version with ${env.isWindsurf ? 'WindSurf' : 'VS Code'} settings`
                    }
                ],
                {
                    placeHolder: 'Choose sync direction',
                    title: `Syncing ${env.isWindsurf ? 'WindSurf' : 'VS Code'} Settings`
                }
            );

            if (!choice) return;

            if (choice.label === 'Download from GitHub') {
                // Download the settings from GitHub
                const gist = await octokit.gists.get({ gist_id: gistId });
                const content = JSON.parse(gist.data.files['vscode-settings.json'].content);
                
                // Show what's going to be synced
                const details = await vscode.window.showQuickPick(
                    [
                        {
                            label: 'Proceed with sync',
                            description: `${content.extensions.length} extensions and settings will be synchronized`
                        },
                        { label: 'Cancel', description: 'Abort the sync operation' }
                    ],
                    {
                        placeHolder: 'Review sync details',
                        title: 'Confirm Synchronization'
                    }
                );

                if (!details || details.label === 'Cancel') return;

                // Apply the downloaded settings
                await applySettings(content.settings);
                await installMissingExtensions(content.extensions);
            } else {
                // Upload the local settings to GitHub
                const localSettings = await getLocalSettings();
                await updateGist(gistId, localSettings);
            }
        } else {
            // Create a new gist if none exists
            const localSettings = await getLocalSettings();
            await createGist(localSettings);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Sync failed: ${error.message}`);
        console.error('Sync error:', error);
    }
}

/**
 * Gets the local VS Code settings.
 * @returns {Object} The local settings object.
 */
async function getLocalSettings() {
    const settingsPath = getSettingsPath();
    const env = detectEnvironment();
    
    let settings = await readSettingsFile(settingsPath);

    const extensions = vscode.extensions.all
        .filter(ext => !ext.packageJSON.isBuiltin)
        .map(ext => ({
            id: ext.id,
            version: ext.packageJSON.version,
            enabled: true
        }));

    return {
        settings: settings,
        extensions: extensions,
        timestamp: new Date().toISOString(),
        environment: env
    };
}

/**
 * Applies the provided settings to the VS Code instance.
 * @param {Object} settings - The settings object to apply.
 */
async function applySettings(settings) {
    const settingsPath = getSettingsPath();
    
    try {
        await writeSettingsFile(settingsPath, settings);
        vscode.window.showInformationMessage(
            'Settings applied successfully! Restart required for some changes.',
            'Restart Now'
        ).then(choice => {
            if (choice === 'Restart Now') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        });
    } catch (error) {
        throw new Error(`Failed to apply settings: ${error.message}`);
    }
}

/**
 * Installs missing extensions.
 * @param {Array<Object>} extensions - The extensions to install.
 */
async function installMissingExtensions(extensions) {
    const installed = vscode.extensions.all.map(ext => ext.id);
    const toInstall = extensions.filter(ext => !installed.includes(ext.id));

    if (toInstall.length === 0) {
        vscode.window.showInformationMessage('All extensions are already installed!');
        return;
    }

    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Installing extensions...",
        cancellable: false
    }, async (progress) => {
        const total = toInstall.length;
        let current = 0;
        let installedCount = 0;
        let failed = [];

        console.log(`Starting installation of ${total} extensions.`);

        for (const ext of toInstall) {
            try {
                progress.report({ 
                    message: `Installing ${ext.id} (${++current}/${total})`,
                    increment: (100/total)
                });
                console.log(`Installing extension: ${ext.id}`);

                // Use the VS Code CLI to install extensions
                const terminal = vscode.window.createTerminal('Extension Installer');
                terminal.sendText(`code --install-extension ${ext.id}`);
                terminal.show();
                
                // Wait a bit to ensure the extension is installed
                await new Promise(resolve => setTimeout(resolve, 5000));
                terminal.dispose();

                // Verify installation
                const isInstalled = vscode.extensions.all.some(e => e.id === ext.id);
                if (isInstalled) {
                    installedCount++;
                    vscode.window.showInformationMessage(`Installed: ${ext.id}`);
                    console.log(`Successfully installed: ${ext.id}`);
                } else {
                    failed.push(ext.id);
                    vscode.window.showErrorMessage(`Failed to verify installation of ${ext.id}`);
                    console.log(`Failed to verify installation of: ${ext.id}`);
                }
            } catch (error) {
                failed.push(ext.id);
                vscode.window.showErrorMessage(`Failed to install ${ext.id}: ${error.message}`);
                console.error(`Error installing ${ext.id}:`, error);
            }
        }

        // Final status report
        if (installedCount > 0) {
            const message = `Installed ${installedCount} extensions.${failed.length > 0 ? ` Failed to install: ${failed.join(', ')}` : ''} Restart required to activate.`;
            console.log(message);
            const choice = await vscode.window.showInformationMessage(message, 'Restart Now');
            if (choice === 'Restart Now') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        } else if (failed.length > 0) {
            const errorMessage = `Failed to install any extensions. Failed items: ${failed.join(', ')}`;
            vscode.window.showErrorMessage(errorMessage);
            console.log(errorMessage);
        }

        console.log('Extension installation process completed.');
    });
}

/**
 * Creates a new gist for the provided settings.
 * @param {Object} content - The settings object to create a gist for.
 */
async function createGist(content) {
    const response = await octokit.gists.create({
        description: 'VS Code Settings Sync',
        public: false,
        files: {
            'vscode-settings.json': {
                content: JSON.stringify(content, null, 2)
            }
        }
    });

    await extensionContext.globalState.update('settingsSyncGistId', response.data.id);
}

/**
 * Updates the gist with the provided settings.
 * @param {string} gistId - The ID of the gist to update.
 * @param {Object} content - The settings object to update the gist with.
 */
async function updateGist(gistId, content) {
    await octokit.gists.update({
        gist_id: gistId,
        files: {
            'vscode-settings.json': {
                content: JSON.stringify(content, null, 2)
            }
        }
    });
}

/**
 * Deactivates the extension.
 */
function deactivate() {}

// Export the activate and deactivate functions
module.exports = {
    activate,
    deactivate
};
