// Edge Function "opcoes-cadeia"
// Devolve a cadeia de opções (calls e puts) de um ativo da B3, por vencimento, a partir do Opcoes.net.br.
// Usada pela tela "Opções" do menu Renda Variável.
//
// Uso: GET /functions/v1/opcoes-cadeia?ticker=BBAS3[&todas=1]
//   (por padrão devolve apenas as séries com cotação; com todas=1 devolve todas as séries listadas)
// Resposta: { ativo: { ticker, preco, variacao, data }, vencimentos: [{ data, diasCorridos, diasUteis, calls: [...], puts: [...] }] }
//   cada série: [código, strike, A/I/O (ATM, ITM, OTM), distância do strike (fração), último preço, variação (fração), data da última negociação, nº de negócios, volume financeiro, modelo (A/E)]

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// deno-lint-ignore no-explicit-any
export function montar(j: any, ticker: string, todas: boolean) {
  const r = j && j.requests && j.requests[0] && j.requests[0].results;
  if (!r || !Array.isArray(r.expirations) || !r.expirations.length) return null;
  const cols: string[] = (r.columns || []).map((c: { id: string }) => c.id);
  const ix = (id: string) => cols.indexOf(id);
  const iS = ix('suffix'), iM = ix('m'), iK = ix('s'), iA = ix('aio'), iD = ix('distancia_do_strike'), iP = ix('p'), iC = ix('c'), iH = ix('h'), iN = ix('n'), iF = ix('f');
  const raiz = ticker.replace(/[0-9]+$/, '').slice(0, 4);
  // deno-lint-ignore no-explicit-any
  const serie = (l: any[]) => [raiz + l[iS], l[iK], l[iA], l[iD], l[iP], l[iC], l[iH], l[iN], l[iF], l[iM]];
  // deno-lint-ignore no-explicit-any
  const filtra = (ls: any[]) => (ls || []).filter((l) => todas || (l[iP] !== null && l[iP] !== undefined)).map(serie);
  const u = r.underlying_asset || {};
  // deno-lint-ignore no-explicit-any
  const vencimentos = r.expirations.map((e: any) => ({ data: e.dt, diasCorridos: e.dc, diasUteis: e.du, calls: filtra(e.calls), puts: filtra(e.puts) }));
  return { ativo: { ticker, preco: u.p ?? null, variacao: u.c ?? null, data: u.h ?? null, maxima: u.ma ?? null, minima: u.mi ?? null }, vencimentos };
}

async function tratar(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase().trim();
  const resp = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } });
  if (!/^[A-Z0-9]{4,6}$/.test(ticker)) return resp({ error: 'Informe ?ticker=BBAS3' }, 400);
  const z = Math.floor(Date.now() / 1000) % 2147483647;
  const alvo = 'https://opcoes.net.br/api/v1?z=' + z + '&r0t=OptionsChain&r0p.columns_info=true&r0p.underlying_asset_id=' + encodeURIComponent(ticker) + '&r0p.underlying_quotes=true';
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 25000);
    const r = await fetch(alvo, { headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://opcoes.net.br/opcoes/bovespa/' + ticker }, signal: c.signal });
    clearTimeout(t);
    if (!r.ok) return resp({ error: 'Fonte indisponível (HTTP ' + r.status + ').' }, 502);
    const dados = montar(await r.json(), ticker, url.searchParams.get('todas') === '1');
    if (!dados) return resp({ error: 'Não há opções listadas para ' + ticker + '.' }, 404);
    return resp(dados);
  } catch (_e) {
    return resp({ error: 'Não foi possível consultar a fonte de dados.' }, 502);
  }
}

// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D && D.serve) D.serve(tratar);
