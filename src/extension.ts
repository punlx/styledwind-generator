// extension.ts
import * as vscode from 'vscode';
import { generateGeneric } from './generateGeneric';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('styledwind.generateGeneric', async () => {
    console.log('[DEBUG] command triggered!');
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active text editor');
      return;
    }

    // ตรวจว่าไฟล์ลงท้าย .css.ts
    const doc = editor.document;
    if (!doc.fileName.endsWith('.css.ts')) {
      vscode.window.showWarningMessage('This command is intended for *.css.ts files');
      return;
    }

    // เรียก getText + format
    const fullText = doc.getText();
    const newText = generateGeneric(fullText);

    if (newText === fullText) {
      vscode.window.showInformationMessage('No changes needed or no styled(...) found');
      return;
    }

    // apply edit
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(fullText.length));
    edit.replace(doc.uri, fullRange, newText);
    await vscode.workspace.applyEdit(edit);

    vscode.window.showInformationMessage('Generic updated for styled(...)!');
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}
