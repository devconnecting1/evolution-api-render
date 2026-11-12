// Substitui o Shiki neste protótipo: o bloco de codigo do DDS nao e usado
// e o pacote real carrega dezenas de gramaticas de linguagem no build.
export async function codeToHtml(code) {
  const escaped = String(code)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<pre class="shiki"><code>${escaped}</code></pre>`;
}
