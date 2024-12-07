const vscode = require('vscode');
const { Octokit } = require('@octokit/rest');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

let octokit;
let extensionContext;

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

function getSettingsPath() {
    const env = detectEnvironment();
    const home = os.homedir();
    const appFolder = env.isWindsurf ? 'windsurf' : 'Code';
    
    let basePath;
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

async function ensureDirectoryExists(filePath) {
    try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') {
            throw error;
        }
    }
}

async function readSettingsFile(filePath) {
    try {
        await ensureDirectoryExists(filePath);
        const content = await fs.readFile(filePath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return {};
        }
        throw error;
    }
}

async function writeSettingsFile(filePath, settings) {
    await ensureDirectoryExists(filePath);
    await fs.writeFile(filePath, JSON.stringify(settings, null, 4), 'utf8');
}

async function activate(context) {
    console.log('VS Code Settings Sync is now active!');
    extensionContext = context;

    // Log environment information
    const env = detectEnvironment();
    console.log('Environment:', env);

    let syncCommand = vscode.commands.registerCommand('vscode-settings-sync.sync', async () => {
        try {
            await syncSettings();
        } catch (error) {
            vscode.window.showErrorMessage(`Sync failed: ${error.message}`);
        }
    });

    let configureCommand = vscode.commands.registerCommand('vscode-settings-sync.configure', async () => {
        await configureGitHub();
    });

    context.subscriptions.push(syncCommand, configureCommand);
}

async function configureGitHub() {
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
            await extensionContext.secrets.store('github-token', token);
            octokit = new Octokit({ auth: token });
            
            // Verify token
            await octokit.users.getAuthenticated();
            
            vscode.window.showInformationMessage('GitHub configuration saved and verified!');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to verify GitHub token: ${error.message}`);
        }
    }
}

async function syncSettings() {
    const token = await extensionContext.secrets.get('github-token');
    if (!token) {
        vscode.window.showErrorMessage('Please configure GitHub token first');
        return;
    }

    octokit = new Octokit({ auth: token });

    try {
        const gistId = await extensionContext.globalState.get('settingsSyncGistId');
        const settingsPath = getSettingsPath();
        const env = detectEnvironment();
        
        if (gistId) {
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

                await applySettings(content.settings);
                await installMissingExtensions(content.extensions);
            } else {
                const localSettings = await getLocalSettings();
                await updateGist(gistId, localSettings);
            }
        } else {
            const localSettings = await getLocalSettings();
            await createGist(localSettings);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Sync failed: ${error.message}`);
        console.error('Sync error:', error);
    }
}

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

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
