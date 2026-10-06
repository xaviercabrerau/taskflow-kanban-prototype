import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

import { GET } from '../route';
import { createClient } from '@supabase/supabase-js';
import { MONITORED_JOBS } from '@/lib/cron-jobs';

// Hallazgo D de la revisión del 2026-10-05: alert-check aceptaba
// `?secret=<CRON_SECRET>` en la URL, y las URLs quedan en logs de acceso,
// historiales de proxies y herramientas de monitoreo. CRON_SECRET además
// autentica otros crons, así que filtrarlo abre más que esta ruta. La única
// credencial aceptada es ahora `Authorization: Bearer <CRON_SECRET>`, que es
// lo que envía Vercel Cron.

const SECRET = 'test-cron-secret';

function request(opts: { header?: string; query?: string } = {}) {
  const url = `http://localhost/api/cron/alert-check${opts.query ? `?${opts.query}` : ''}`;
  return new Request(url, { headers: opts.header ? { authorization: opts.header } : {} });
}

describe('GET /api/cron/alert-check (autenticación)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    delete process.env.ALERT_WEBHOOK_URL;

    // Todo sano: la comprobación de la app y la de los crons no dan problemas.
    const healthyRows = MONITORED_JOBS.map((j) => ({
      job_name: j.name,
      expected_interval: j.schedule,
      last_run_at: '2026-10-05T00:00:00.000Z',
      last_status: 'succeeded',
      is_stale: false,
    }));
    (createClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({ select: jest.fn(() => ({ limit: jest.fn(() => Promise.resolve({ error: null })) })) })),
      rpc: jest.fn(() => Promise.resolve({ data: healthyRows, error: null })),
    });
  });

  it('acepta Authorization: Bearer con el secreto correcto', async () => {
    const res = await GET(request({ header: `Bearer ${SECRET}` }));

    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('rechaza el secreto enviado solo por la URL (?secret=)', async () => {
    const res = await GET(request({ query: `secret=${SECRET}` }));

    expect(res.status).toBe(401);
  });

  it('rechaza una cabecera con un secreto incorrecto', async () => {
    const res = await GET(request({ header: 'Bearer otro-secreto' }));

    expect(res.status).toBe(401);
  });

  it('rechaza la petición sin ninguna credencial', async () => {
    const res = await GET(request());

    expect(res.status).toBe(401);
  });

  it('rechaza todo si CRON_SECRET no está configurado', async () => {
    delete process.env.CRON_SECRET;

    const res = await GET(request({ header: 'Bearer undefined' }));

    expect(res.status).toBe(401);
  });
});
