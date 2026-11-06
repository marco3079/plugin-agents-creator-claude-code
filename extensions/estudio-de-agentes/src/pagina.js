// Monta o HTML da webview do Estúdio de Agentes (roda no Node, dentro da extensão).
import { randomBytes } from 'node:crypto'

/**
 * Gera o nonce da CSP da página.
 * @returns {string} 32 caracteres hexadecimais
 */
export function gerarNonce() {
  return randomBytes(16).toString('hex')
}

/**
 * Escapa um valor para uso dentro de atributo HTML.
 * @param {unknown} t
 * @returns {string}
 */
function escAttr(t) {
  return String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Normaliza o lugar da página: só 'aba' é aceito; qualquer outro valor vira 'lateral'.
 * @param {unknown} lugar
 * @returns {'lateral'|'aba'}
 */
function lugarValido(lugar) {
  return lugar === 'aba' ? 'aba' : 'lateral'
}

/**
 * Página com o painel do Estúdio (script liberado pelo nonce).
 * @param {{ cspSource: string, scriptUri: string, estiloUri: string, nonce: string, lugar?: 'lateral'|'aba' }} opcoes
 * @returns {string} HTML completo
 */
export function paginaDoEstudio({ cspSource, scriptUri, estiloUri, nonce, lugar = 'lateral' }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${escAttr(cspSource)} data:; style-src ${escAttr(cspSource)} 'unsafe-inline'; font-src ${escAttr(cspSource)}; script-src 'nonce-${escAttr(nonce)}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${escAttr(estiloUri)}">
<title>Estúdio de Agentes</title>
</head>
<body data-lugar="${lugarValido(lugar)}">
<div id="raiz"><div class="carregando">Carregando o Estúdio de Agentes…</div></div>
<script nonce="${escAttr(nonce)}" src="${escAttr(scriptUri)}"></script>
</body>
</html>`
}

/**
 * Página para quando não há pasta de projeto aberta. Não carrega script.
 * @param {{ cspSource: string, estiloUri: string, lugar?: 'lateral'|'aba' }} opcoes
 * @returns {string} HTML completo
 */
export function paginaSemPasta({ cspSource, estiloUri, lugar = 'lateral' }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${escAttr(cspSource)} data:; style-src ${escAttr(cspSource)} 'unsafe-inline'; font-src ${escAttr(cspSource)};">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${escAttr(estiloUri)}">
<title>Estúdio de Agentes</title>
</head>
<body data-lugar="${lugarValido(lugar)}">
<div class="vazio"><p><b>Abra uma pasta de projeto</b> para usar o Estúdio de Agentes.</p><p>Arquivo › Abrir Pasta… Os agentes do projeto ficam em <code>.claude/agents</code>; os seus, em <code>~/.claude/agents</code>.</p></div>
</body>
</html>`
}
