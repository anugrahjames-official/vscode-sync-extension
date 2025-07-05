# VS Code Settings Sync (Discontinued)

A VS Code extension that helps you sync your VS Code settings and extensions using GitHub Gists.

## Features

- Sync VS Code settings across multiple machines and VS Code based IDEs like WindSurf and Cursor
- Sync installed extensions
- Secure storage of settings using private GitHub Gists
- Easy to configure and use

## Setup

1. Install the extension
2. Generate a GitHub Personal Access Token:
   - Go to GitHub Settings > Developer Settings > Personal Access Tokens
   - Create a new token with 'gist' scope
   - Copy the generated token
3. In VS Code:
   - Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
   - Type "Configure GitHub Sync" and press Enter
   - Paste your GitHub token when prompted

## Usage

To sync your settings:

1. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
2. Type "Configure GitHub Sync" and press Enter
3. Paste your GitHub token when prompted
4. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
5. Type "Sync Settings and Extensions" and press Enter

Your settings and extensions will be synced to a private GitHub Gist.

## Requirements

- VS Code 1.74.0 or higher
- GitHub account
- Internet connection

## Extension Settings

This extension contributes the following commands:

- `vscode-settings-sync.sync`: Sync your settings and extensions
- `vscode-settings-sync.configure`: Configure GitHub token

## Known Issues

- Initial sync may take some time depending on the number of extensions
- Some extension settings might require manual configuration
- It doesn't install anything and just shows a message "All extensions are already installed!" (Help me fix this ASAP)

## Release Notes

### 0.0.1

Initial release:

- Basic sync functionality
- GitHub Gist integration
- Secure token storage
