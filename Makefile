##  First Extension
install-yo:
	npm install -g yo generator-code

init-yo:
	yo code
# ? What type of extension do you want to create? New Extension (TypeScript)
# ? What's the name of your extension? HelloWorld
### Press <Enter> to choose default for all options below ###

# ? What's the identifier of your extension? helloworld
# ? What's the description of your extension? LEAVE BLANK
# ? Initialize a git repository? Yes
# ? Bundle the source code with webpack? No
# ? Which package manager to use? npm

# ? Do you want to open the new folder with Visual Studio Code? Open with `code`





##  Publishing Extensions
install-vsce:
	npm install -g @vscode/vsce


package-vsce:
	vsce package --allow-star-activation 
# myExtension.vsix generated	

publish-vsce:
	vsce publish
# <publisher id>.myExtension published to VS Code Marketplace	