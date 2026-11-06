// Abre uma conversa nova do Claude Code com um texto já digitado (sem enviar). Recebe a API do VS Code por parâmetro para poder ser testado.
export const COMANDO_CLAUDE = 'claude-vscode.primaryEditor.open'
export const EXTENSAO_CLAUDE = 'anthropic.claude-code'

/**
 * @param {typeof import('vscode')} vscode
 * @returns {(texto: string) => Promise<'aba'|'uri'|'copiado'>}
 */
export function criarAbridorDoClaude(vscode) {
  return async function abrirNoClaude(texto) {
    const comandos = await vscode.commands.getCommands(true)
    if (comandos.includes(COMANDO_CLAUDE)) {
      try {
        await vscode.commands.executeCommand(COMANDO_CLAUDE, undefined, texto)
        return 'aba'
      } catch {
        // tenta o link abaixo
      }
    }
    if (vscode.extensions.getExtension(EXTENSAO_CLAUDE)) {
      const uri = vscode.Uri.parse(`${vscode.env.uriScheme}://${EXTENSAO_CLAUDE}/open?prompt=${encodeURIComponent(texto)}`)
      if (await vscode.env.openExternal(uri)) return 'uri'
    }
    await vscode.env.clipboard.writeText(texto)
    void vscode.window.showWarningMessage('Não achei a extensão Claude Code. O pedido foi copiado: cole numa conversa do Claude Code.')
    return 'copiado'
  }
}
