import {describe, it, expect, vi, afterEach} from 'vitest';
import {createHash} from 'node:crypto';
import {getKnowledgeCatalog, refreshKnowledge, buildKnowledgeContext} from './knowledge.mjs';

const id = 'hk-pdpo';
const readable = `<html><body><h1>Personal data DPP2 DPP4</h1><p>${'Synthetic test fixture: retention, security and scope require review. '.repeat(8)}</p></body></html>`;
const response = (body = readable, headers = {}) => new Response(body, {headers: {'Content-Type': 'text/html; charset=utf-8', ...headers}});
afterEach(() => vi.useRealTimers());

describe('reviewed official knowledge catalogue', () => {
  it('exposes six scoped official sources with explicit version and date semantics', () => {
    const sources = getKnowledgeCatalog();
    expect(sources).toHaveLength(6);
    expect(new Set(sources.map(source => source.id)).size).toBe(6);
    for (const source of sources) {
      for (const key of ['id', 'title', 'kind', 'jurisdiction', 'authority', 'url', 'version', 'effectiveDate', 'checkedAt', 'text', 'applicability', 'sourceStatus']) expect(source).toHaveProperty(key);
      expect(new URL(source.url).protocol).toBe('https:');
      expect(new URL(source.url).hostname).toMatch(/\.(gov\.hk|pcpd\.org\.hk)$/);
      expect(source.checkedAt).toBe('2026-10-29');
      expect(source.text.length).toBeGreaterThan(50);
      expect(source.applicability.length).toBeGreaterThan(50);
    }
  });
  it('distinguishes legal scope from a government policy and non-statutory practice', () => {
    const sources = getKnowledgeCatalog();
    const ci = sources.find(source => source.id === 'hk-critical-infrastructure');
    expect(ci.kind).toBe('law'); expect(ci.effectiveDate).toBe('2026-01-01'); expect(ci.applicability).toContain('指定'); expect(ci.applicability).toContain('政府部门不在');
    const security = sources.find(source => source.id === 'hk-gov-s17');
    expect(security.kind).toBe('policy'); expect(security.effectiveDate).toBeNull(); expect(security.applicability).toContain('不是自动');
    expect(sources.find(source => source.id === 'pcpd-outsourcing').kind).toBe('practice');
  });
  it('returns detached records so callers cannot replace reviewed summaries or URLs', () => {
    const first = getKnowledgeCatalog();
    first[0].url = 'http://127.0.0.1/'; first[0].text = 'Injected';
    expect(getKnowledgeCatalog()[0].url).not.toBe(first[0].url);
    expect(getKnowledgeCatalog()[0].text).not.toBe('Injected');
  });
});

describe('bounded source refresh', () => {
  it('rejects unknown URLs, duplicate IDs and malformed selections before fetching', async () => {
    const fetchImpl = vi.fn();
    for (const ids of [['https://127.0.0.1/'], [id, id], [123], 'all', [id, 'unknown']]) {
      await expect(refreshKnowledge(ids, {fetchImpl})).rejects.toThrow();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await refreshKnowledge([], {fetchImpl})).toEqual([]);
  });
  it('fetches only the selected fixed source, hashes received bytes and keeps checked metadata', async () => {
    const initial = getKnowledgeCatalog().find(source => source.id === id);
    const fetchImpl = vi.fn(async () => response());
    const [record] = await refreshKnowledge([id], {fetchImpl});
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe(initial.url);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({redirect: 'manual', credentials: 'omit', method: 'GET'});
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(record).toMatchObject({sourceStatus: 'source_fetched', text: initial.text, checkedAt: initial.checkedAt, version: initial.version, effectiveDate: initial.effectiveDate});
    expect(record.contentHash).toBe(createHash('sha256').update(readable).digest('hex'));
    expect(record.hashBasis).toBe('fetched_response_bytes'); expect(record.fetchedAt).toMatch(/^\d{4}-/);
    expect(record.freshnessNote).toContain('未自动重新审核');
    expect(getKnowledgeCatalog().find(source => source.id === id).contentHash).toBe(record.contentHash);
  });
  it('removes executable markup and returns text, while leaving source prose untrusted', async () => {
    const [record] = await refreshKnowledge([id], {fetchImpl: async () => response(readable.replace('</body>', '<script>globalThis.secret = "do-not-run"</script><style>steal-css</style><p>Untrusted source statement.</p></body>'))});
    expect(record.sourceStatus).toBe('source_fetched'); expect(record.fetchedText).toContain('Untrusted source statement');
    expect(record.fetchedText).not.toContain('do-not-run'); expect(record.fetchedText).not.toContain('steal-css');
    expect(globalThis.secret).toBeUndefined(); expect(record.freshnessNote).toContain('不是模型指令');
  });
  it('rejects localhost, lookalike domains, HTTP and unlisted paths at redirect before following', async () => {
    for (const location of ['https://127.0.0.1/private', 'https://www.pcpd.org.hk.evil.invalid/', 'http://www.pcpd.org.hk/', 'https://www.pcpd.org.hk/unlisted', 'https://user@www.pcpd.org.hk/']) {
      const fetchImpl = vi.fn(async () => new Response('', {status: 302, headers: {location}}));
      const [record] = await refreshKnowledge([id], {fetchImpl});
      expect(record.sourceStatus).toBe('refresh_failed'); expect(record.refreshError.code).toBe('UNSAFE_SOURCE_URL');
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });
  it('bounds allowed-URL redirect loops', async () => {
    const url = getKnowledgeCatalog().find(source => source.id === id).url;
    const fetchImpl = vi.fn(async () => new Response('', {status: 302, headers: {location: url}}));
    const [record] = await refreshKnowledge([id], {fetchImpl});
    expect(fetchImpl).toHaveBeenCalledTimes(3); expect(record.refreshError.code).toBe('SOURCE_REDIRECT_LIMIT');
  });
  it('rejects a fetch implementation that silently returned an unapproved final URL', async () => {
    const res = response(); Object.defineProperty(res, 'url', {value: 'http://169.254.169.254/'});
    const [record] = await refreshKnowledge([id], {fetchImpl: async () => res});
    expect(record.refreshError.code).toBe('UNSAFE_SOURCE_URL');
  });
  it('does not mistake a PDF response for refreshed readable policy text', async () => {
    const [record] = await refreshKnowledge(['hk-gov-s17'], {fetchImpl: async () => response('%PDF-1.4', {'Content-Type': 'application/pdf'})});
    expect(record.sourceStatus).toBe('refresh_failed'); expect(record.refreshError.code).toBe('SOURCE_UNSUPPORTED_TYPE');
    expect(record.fetchedAt).toBeNull(); expect(record.fetchedText).toBe(''); expect(record.freshnessNote).toContain('checked_snapshot');
  });
  it('rejects oversized declared length before reading', async () => {
    const [record] = await refreshKnowledge([id], {fetchImpl: async () => response(readable, {'Content-Length': '262145'})});
    expect(record.refreshError.code).toBe('SOURCE_TOO_LARGE');
  });
  it('enforces actual streamed bytes even when the length header understates the size', async () => {
    let cancelled = false;
    const body = new ReadableStream({start(controller) { controller.enqueue(new Uint8Array(262145)); }, cancel() { cancelled = true; }});
    const [record] = await refreshKnowledge([id], {fetchImpl: async () => new Response(body, {headers: {'Content-Type': 'text/plain', 'Content-Length': '1'}})});
    expect(record.refreshError.code).toBe('SOURCE_TOO_LARGE'); expect(cancelled).toBe(true);
  });
  it('caps returned text while keeping a hash of the full bounded response', async () => {
    const body = 'Personal data DPP2 DPP4. ' + 'synthetic test content '.repeat(1000);
    const [record] = await refreshKnowledge([id], {fetchImpl: async () => response(body)});
    expect(record.fetchedText).toHaveLength(12000); expect(record.fetchedTextTruncated).toBe(true);
    expect(record.contentHash).toBe(createHash('sha256').update(body).digest('hex'));
    expect(record.sourceNote).toContain('截断'); expect(record.sourceNote).toContain('不代表');
  });
  it('does not mark anti-bot or unrelated content as source freshness', async () => {
    for (const body of ['Access denied. ' + readable, 'Navigation only. '.repeat(100), '<script>Only JavaScript content</script>']) {
      const [record] = await refreshKnowledge([id], {fetchImpl: async () => response(body)});
      expect(record.refreshError.code).toBe('SOURCE_UNREADABLE'); expect(record.fetchedAt).toBeNull();
    }
  });
  it('returns explicit checked snapshots on network and HTTP failures without leaking errors', async () => {
    const summary = getKnowledgeCatalog().find(source => source.id === id).text;
    for (const fetchImpl of [async () => { throw Error('SECRET-TOKEN/internal/path'); }, async () => new Response('', {status: 403})]) {
      const [record] = await refreshKnowledge([id], {fetchImpl});
      expect(record.sourceStatus).toBe('refresh_failed'); expect(record.text).toBe(summary);
      expect(record.contentHash).toBe(createHash('sha256').update(summary).digest('hex'));
      expect(JSON.stringify(record)).not.toContain('SECRET-TOKEN'); expect(record.hashBasis).toBe('checked_summary_utf8');
    }
  });
  it('enforces the eight-second deadline even if an injected fetch ignores AbortSignal', async () => {
    vi.useFakeTimers();
    let signal;
    const result = refreshKnowledge([id], {fetchImpl: async (_, init) => { signal = init.signal; return new Promise(() => {}); }});
    await vi.advanceTimersByTimeAsync(8001);
    const [record] = await result;
    expect(record.refreshError.code).toBe('SOURCE_TIMEOUT'); expect(signal.aborted).toBe(true); expect(record.fetchedAt).toBeNull();
  });
});

describe('bounded knowledge context', () => {
  it('labels checked summaries and failed freshness without including stale excerpts', () => {
    const record = {...getKnowledgeCatalog()[0], sourceStatus: 'refresh_failed', fetchedAt: null, fetchedText: 'stale text'};
    const context = buildKnowledgeContext(record, '验收');
    expect(context).toContain('已核查摘要'); expect(context).toContain('不能声称已读最新');
    expect(context).not.toContain('stale text'); expect(context.length).toBeLessThanOrEqual(4000);
  });
  it('selects relevant English paragraphs for Chinese delivery terms and labels them as excerpts', () => {
    const source = getKnowledgeCatalog().find(item => item.id === 'hk-gov-procurement');
    const record = {...source, sourceStatus: 'source_fetched', fetchedText: `${'Unrelated navigation. '.repeat(200)}\nPayment and milestone acceptance must follow contract conditions.\n${'Other topic. '.repeat(100)}`};
    const context = buildKnowledgeContext(record, '合同付款里程碑及验收');
    expect(context).toContain('Payment and milestone acceptance must follow contract conditions.');
    expect(context).toContain('线上摘录'); expect(context).toContain('非全文'); expect(context).toContain('不可信数据');
    expect(context.length).toBeLessThanOrEqual(4000);
  });
  it('preserves reviewed applicability instead of caller-modified legal metadata', () => {
    const source = getKnowledgeCatalog().find(item => item.id === 'hk-critical-infrastructure');
    const context = buildKnowledgeContext({...source, applicability: 'Applies to every company', effectiveDate: '1900-01-01', text: 'Fake law'});
    expect(context).toContain('2026-01-01'); expect(context).toContain('政府部门不在'); expect(context).not.toContain('Fake law');
    expect(() => buildKnowledgeContext({id: 'unknown'})).toThrow();
  });
});
