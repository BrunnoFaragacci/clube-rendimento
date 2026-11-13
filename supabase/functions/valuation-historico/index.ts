// Edge Function "valuation-historico"
// Devolve, para cada ticker informado, o P/L, o P/VP, o LPA e o VPA atuais e o histórico anual (últimos 10 anos)
// de P/L e P/VP, obtidos do Investidor10. Usada pela tela "Valuation (P/L e P/VP)" do site.
//
// Uso: GET /functions/v1/valuation-historico?tickers=PETR4,VALE3,WEGE3   (até 15 tickers por chamada)
// Resposta: { dados: { PETR4: { id, pl: { atual, anos: [[2025, 4.1], ...] }, pvp: {...}, lpa, vpa, lpaAnos: [[2025, 1.5], ...], vpaAnos: [...] }, ... }, falhas: ["XXXX3"] }
//
// Publicação: painel do Supabase > Edge Functions > Deploy a new function > nome "valuation-historico" (colar este arquivo).
// A função aceita chamadas com a chave pública (anon) do projeto, como as demais funções do site.

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_TICKERS = 15;
const ids = new Map<string, string>();

function comTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...init, signal: c.signal }).finally(() => clearTimeout(t));
}

function numero(v: unknown): number | null {
  const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : NaN);
  return Number.isFinite(n) ? n : null;
}

// Linha do histórico: o item "Atual" traz o valor corrente; os demais, o valor ao fim de cada ano
function lerIndicador(lista: unknown): { atual: number | null; anos: [number, number][] } {
  const atual = { atual: null as number | null, anos: [] as [number, number][] };
  if (!Array.isArray(lista)) return atual;
  for (const it of lista) {
    const v = numero(it && (it as { value?: unknown }).value);
    const ano = String((it && (it as { year?: unknown }).year) ?? '');
    if (v === null) continue;
    if (ano === 'Atual') atual.atual = v;
    else if (/^\d{4}$/.test(ano)) atual.anos.push([parseInt(ano, 10), Math.round(v * 10000) / 10000]);
  }
  atual.anos.sort((a, b) => a[0] - b[0]);
  return atual;
}

export async function coletar(ticker: string) {
  const t = ticker.toLowerCase();
  let id = ids.get(t);
  if (!id) {
    const pagina = await comTimeout('https://investidor10.com.br/acoes/' + t + '/', { headers: { 'User-Agent': UA, 'Accept': 'text/html' } }, 9000);
    if (!pagina.ok) throw new Error('página ' + pagina.status);
    const m = /historico-indicadores\/(\d+)/.exec(await pagina.text());
    if (!m) throw new Error('identificador não encontrado');
    id = m[1];
    ids.set(t, id);
  }
  const r = await comTimeout('https://investidor10.com.br/api/historico-indicadores/' + id + '/10?v=2', {
    headers: { 'User-Agent': UA, 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://investidor10.com.br/acoes/' + t + '/' },
  }, 9000);
  if (!r.ok) throw new Error('histórico ' + r.status);
  const j = await r.json();
  const pl = lerIndicador(j['P/L']);
  const pvp = lerIndicador(j['P/VP']);
  const lpaI = lerIndicador(j['LPA']);
  const vpaI = lerIndicador(j['VPA']);
  if (pl.atual === null && pvp.atual === null && !pl.anos.length && !pvp.anos.length) throw new Error('sem indicadores');
  return { id, pl, pvp, lpa: lpaI.atual, vpa: vpaI.atual, lpaAnos: lpaI.anos, vpaAnos: vpaI.anos };
}

async function tratar(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  const tickers = Array.from(new Set((url.searchParams.get('tickers') || '').toUpperCase().split(',')
    .map((s) => s.trim()).filter((s) => /^[A-Z0-9]{4,6}$/.test(s)))).slice(0, MAX_TICKERS);
  if (!tickers.length) {
    return new Response(JSON.stringify({ error: 'Informe ?tickers=PETR4,VALE3' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  const dados: Record<string, unknown> = {};
  const falhas: string[] = [];
  await Promise.all(tickers.map(async (tk) => {
    try { dados[tk] = await coletar(tk); } catch (_e) { falhas.push(tk); }
  }));
  return new Response(JSON.stringify({ dados, falhas, atualizadoEm: new Date().toISOString() }), {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  });
}

// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D && D.serve) D.serve(tratar);
