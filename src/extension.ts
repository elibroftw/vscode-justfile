// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// TODO: in settings, allow a command prefix (e.g. nix develop --print-build-logs --command)

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated

	// TODO:
	// https://code.visualstudio.com/api/references/contribution-points#contributes.taskDefinitions
	const workspaceRoot = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
		? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
	if (!workspaceRoot) {
		return;
	}
	vscode.tasks.registerTaskProvider(JustTaskProvider.JustType, new JustTaskProvider(workspaceRoot));
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	// The code you place here will be executed every time your command is executed
	// Display a message box to the user
	// TODO: parse just -l
	// let task = new vscode.Task({ type: 'npm', script: 'test' }, ....);

	// vscode.window.showInformationMessage('Hello VsCode!');

	// https://github.com/DiemasMichiels/Emulator
	// https://code.visualstudio.com/api/references/vscode-api#commands
	// commands.registerCommand ???
	const disposable = vscode.commands.registerCommand('just-recipe-runner.listRecipes', () => {
	});
	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() { }


/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { error } from 'console';
import { EOL } from 'os';

export class JustTaskProvider implements vscode.TaskProvider {
	static JustType = 'just';
	private justPromise: Thenable<vscode.Task[]> | undefined = undefined;

	constructor(workspaceRoot: string) {
		const pattern = path.join(workspaceRoot, 'justfile');
		const fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
		// DOES PROVIDE TASKS GET CALLED AGAIN???
		fileWatcher.onDidChange(() => this.justPromise = undefined);
		fileWatcher.onDidCreate(() => this.justPromise = undefined);
		fileWatcher.onDidDelete(() => this.justPromise = undefined);
	}

	public provideTasks(): Thenable<vscode.Task[]> | undefined {
		if (!this.justPromise) {
			this.justPromise = getJustTasks();
		}
		return this.justPromise;
	}

	public resolveTask(_task: vscode.Task): vscode.Task | undefined {
		const task = _task.definition.task;
		// A just task consists of a task and an optional file as specified in justTaskDefinition
		// Make sure that this looks like a just task by checking that there is a task.
		if (task) {
			// resolveTask requires that the same definition object be used.
			const definition: JustTaskDefinition = <any>_task.definition;
			// TODO: get the shell
			// TODO: settings to use nix instead
			return new vscode.Task(definition, _task.scope ?? vscode.TaskScope.Workspace, definition.task, 'just', new vscode.ShellExecution(`${definition.task}`, {
				executable: '/nix/var/nix/profiles/default/bin/nix',
				shellArgs: ['develop', '--print-build-logs', '--command', 'just'],
				env: process.env as Record<string, string>
			}));
		}
		return undefined;
	}
}

function exists(file: string): Promise<boolean> {
	return new Promise<boolean>((resolve, _reject) => {
		fs.exists(file, (value) => {
			resolve(value);
		});
	});
}

function exec(command: string, options: cp.ExecOptions): Promise<{ stdout: string; stderr: string }> {
	return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
		cp.exec(command, options, (error, stdout, stderr) => {
			if (error) {
				reject({ error, stdout, stderr });
			}
			resolve({ stdout, stderr });
		});
	});
}

let _channel: vscode.OutputChannel;
function getOutputChannel(): vscode.OutputChannel {
	if (!_channel) {
		_channel = vscode.window.createOutputChannel('just Auto Detection');
	}
	return _channel;
}

interface JustTaskDefinition extends vscode.TaskDefinition {
	/**
	 * The task name
	 */
	task: string;
	/**
	 * The justfile containing the task
	 */
	file?: string;
}

const buildNames: string[] = ['build', 'compile', 'watch'];
function isBuildTask(name: string): boolean {
	for (const buildName of buildNames) {
		if (name.indexOf(buildName) !== -1) {
			return true;
		}
	}
	return false;
}

const testNames: string[] = ['test'];
function isTestTask(name: string): boolean {
	for (const testName of testNames) {
		if (name.indexOf(testName) !== -1) {
			return true;
		}
	}
	return false;
}

async function getJustTasks(): Promise<vscode.Task[]> {
	// https://code.visualstudio.com/api/extension-guides/task-provider
	// let shell = vscode.env.shell;
	// let task = new vscode.Task({ type: 'npm', script: 'test' }, ....);

	const workspaceFolders = vscode.workspace.workspaceFolders;
	const result: vscode.Task[] = [];
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return result;
	}
	for (const workspaceFolder of workspaceFolders) {
		const folderString = workspaceFolder.uri.fsPath;
		if (!folderString) {
			continue;
		}
		const justfile = path.join(folderString, 'justfile');
		if (!await exists(justfile)) {
			continue;
		}

		const commandLine = 'just -l';
		try {
			// run just -l in the workspaceFolder
			// TODO: iterate each non-ignored folder in the workspace folder
			const { stdout, stderr } = await exec(commandLine, { cwd: folderString });
			if (stderr && stderr.length > 0) {
				getOutputChannel().appendLine(stderr);
				getOutputChannel().show(true);
			}
			if (stdout) {
				const recipeLines = stdout.trim().split('\n').splice(1);
				for (const line of 	recipeLines) {
					const [recipeName, docComment] = line.split('#', 2);
					const taskName = recipeName.trim();
					const taskDetail = docComment?.trim();

					const kind: JustTaskDefinition = {
						type: 'just',
						task: taskName,
						file: path.join(workspaceFolder.name, 'justfile')
					};

					const task = new vscode.Task(kind, workspaceFolder, taskName, 'just', new vscode.ShellExecution(`just ${taskName}`));
					task.detail = taskDetail;
					const lowerCaseLine = line.toLowerCase();
					if (isBuildTask(lowerCaseLine)) {
						task.group = vscode.TaskGroup.Build;
					} else if (isTestTask(lowerCaseLine)) {
						task.group = vscode.TaskGroup.Test;
					}
					result.push(task);
				}
			}
		} catch (err: any) {
			const channel = getOutputChannel();
			if (err.stderr) {
				channel.appendLine(err.stderr);
			}
			if (err.stdout) {
				channel.appendLine(err.stdout);
			}
			channel.appendLine('Auto detecting just tasks failed.');
			channel.show(true);
		}
	}
	return result;
}
