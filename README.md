# Just Recipe Runner

An extension that parses `justfile`s and adds recipes as tasks in VSCode. This extension does things the right way unlike other extensions I've tried out that use commands. Hit "Run Task" in the command pallete, and click `just` to see the parsed recipes that you can run.

## Features

- Task integration for justfile recipes including a description when comments are used
- Run tasks inside nix shell (`nix develop`) if `flake.nix` exists, always if set to yes, and never if set to no in settings

![demo](images/demo.gif)

<!-- To create a gif, use follow https://superuser.com/a/893031 and set width to 1440. Next time zoom into the command palette -->

## Extension Settings

- `just-recipe-runner.useNix`: whether to run just recipe command in nix or not

## Publishing

- `npx @vscode/vsce package` to build
- `npx @vscode/vsce publish` requires a personal access token
- [Visual Studio Marketplace Publisher](https://marketplace.visualstudio.com/manage/publishers/ElijahLopez)
- [Publishing Extensions tutorial](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
