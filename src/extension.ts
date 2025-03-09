import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	const workspaceRoot = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
		? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
	if (!workspaceRoot) {
		return;
	}
	vscode.tasks.registerTaskProvider(JustTaskProvider.JustType, new JustTaskProvider(workspaceRoot));
}

// This method is called when your extension is deactivated
export function deactivate() { }

export class JustTaskProvider implements vscode.TaskProvider {
	static JustType = 'just';
	private justPromise: Thenable<vscode.Task[]> | undefined = undefined;
	private flakeExists?: boolean;

	constructor(workspaceRoot: string) {
		const pattern = path.join(workspaceRoot, 'justfile');
		const fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
		fileWatcher.onDidChange(() => this.justPromise = undefined);
		fileWatcher.onDidCreate(() => this.justPromise = undefined);
		fileWatcher.onDidDelete(() => this.justPromise = undefined);
		flakeNixExists(workspaceRoot).then(x => this.flakeExists = x);
	}

	public provideTasks(): Thenable<vscode.Task[]> | undefined {
		if (!this.justPromise) {
			this.justPromise = getJustTasks();
		}
		return this.justPromise;
	}

	public resolveTask(_task: vscode.Task): vscode.Task | undefined {
		// resolve tasks allows vscode to skip the provideTasks and execute a specific task without knowing it's available
		const task = _task.definition.task;
		// A just task consists of a task and an optional file as specified in justTaskDefinition
		// Make sure that this looks like a just task by checking that there is a task.
		if (task) {
			// resolveTask requires that the same definition object be used.
			const definition: JustTaskDefinition = <any>_task.definition;
			const commandLine = getCommandLine(definition.task, this.flakeExists ?? false);
			return new vscode.Task(definition, _task.scope ?? vscode.TaskScope.Workspace, definition.task, 'just', getExecution(definition));
		}
		return undefined;
	}
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
	 * The dir of the justfile containing the task
	 */
	dir: string;
	promptForArgs: boolean;
	flakeExists: boolean;
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

async function exists(filePath: string): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
		return true;
	} catch {
		return false;
	}
}

async function flakeNixExists(folder: string): Promise<boolean> {
	return await exists(path.join(folder, 'flake.nix'));
}

enum UseNix {
	AUTO = 'auto',
	TRUE = 'yes',
	FALSE = 'no'
}

const EXPERIMENTAL_FEATURE = false;

function getExecution(definition: JustTaskDefinition) {
	const config = vscode.workspace.getConfiguration('just-recipe-runner');
	let useNix = config.get('useNix') as UseNix;
	if (useNix === UseNix.AUTO) {
		useNix = definition.flakeExists ? UseNix.TRUE : UseNix.FALSE;
	}

	let baseCommand = useNix === UseNix.TRUE ?
		`/nix/var/nix/profiles/default/bin/nix develop --print-build-logs --command just ${definition.task}`
		: `just ${definition.task}`;

	if (definition.promptForArgs && EXPERIMENTAL_FEATURE) {
		const isWindows = process.platform === 'win32';
		if (isWindows) {
			// Windows - powershell
			const promptCmd = `$cmdargs = Read-Host 'Enter arguments for ${definition.task}'`;
			baseCommand = `${promptCmd}; ${baseCommand} $cmdargs`;
		} else {
			// Linux/macOS - bash/zsh
			const promptCmd = `read -p "Enter arguments for ${definition.task}: " cmdargs`;
			baseCommand = `${promptCmd}; ${baseCommand} "$cmdargs"`;
		}
	}

	return new vscode.ShellExecution(baseCommand, { cwd: definition.dir });
}

function getCommandLine(taskName: string, flakeExists: boolean): string {
	const config = vscode.workspace.getConfiguration('just-recipe-runner');
	let useNix = config.get('useNix') as UseNix;
	if (useNix === UseNix.AUTO) { // auto
		useNix = flakeExists ? UseNix.TRUE : UseNix.FALSE;
	}
	if (useNix === UseNix.TRUE) {
		return `/nix/var/nix/profiles/default/bin/nix develop --print-build-logs --command just ${taskName}`;
	}
	return `just ${taskName}`;
}

async function getJustTasks(): Promise<vscode.Task[]> {
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
		if (!fs.existsSync(justfile)) {
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
				for (const line of recipeLines) {
					const [recipeName, docComment] = line.split('#', 2);
					const parts = recipeName.trim().split(' ');
					const taskName = parts[0];
					const taskDetail = docComment?.trim();

					const flakeExists = await flakeNixExists(workspaceFolder.uri.fsPath);
					const definition: JustTaskDefinition = {
						type: 'just',
						task: taskName,
						dir: workspaceFolder.uri.fsPath,
						promptForArgs: parts.length > 1,
						flakeExists
					};
					const task = new vscode.Task(definition, workspaceFolder, taskName, 'just', getExecution(definition));
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
