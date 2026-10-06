import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

import { POST as linkExistingUser } from '../route';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

// Hallazgo C de la revisión del 2026-10-05: link-existing-user dejaba a
// cualquier owner (y crear una organización está abierto a cualquier usuario
// autenticado) confirmar el email y PONER LA CONTRASEÑA de cualquier cuenta de
// Auth que no perteneciera a ninguna organización. Eso es una toma de cuenta:
// si la cuenta ya tiene el email verificado, su dueño real la usa y nadie debe
// poder cambiarle las credenciales desde aquí.

const ORG = 'org-123';
const TARGET_ID = 'new-user-id';
const EMAIL = 'persona@example.com';

function existingUser(confirmed: boolean) {
  return {
    id: TARGET_ID,
    email: EMAIL,
    email_confirmed_at: confirmed ? '2026-09-01T00:00:00.000Z' : null,
    user_metadata: { full_name: 'Nombre previo' },
  };
}

describe('POST /api/admin/link-existing-user', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- service-role admin client mock
  let updateUserById: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let memberInsert: any;

  function setup(user: ReturnType<typeof existingUser>, callerRole: 'owner' | 'member' = 'owner') {
    (createClient as jest.Mock).mockResolvedValue({
      auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'owner-user' } }, error: null })) },
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn(() =>
          Promise.resolve({ data: { organization_id: ORG, org_role: callerRole }, error: null })
        ),
      })),
    });

    updateUserById = jest.fn(() => Promise.resolve({ error: null }));
    memberInsert = jest.fn(() => Promise.resolve({ error: null }));
    (createServiceClient as jest.Mock).mockReturnValue({
      auth: {
        admin: {
          listUsers: jest.fn(() => Promise.resolve({ data: { users: [user] }, error: null })),
          updateUserById,
        },
      },
      from: jest.fn((table: string) => {
        if (table === 'organization_members') {
          return {
            // El destino no pertenece a ninguna organización.
            select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })) })) })),
            insert: memberInsert,
          };
        }
        return { update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })) };
      }),
    });
  }

  const post = (body: object) =>
    linkExistingUser(
      new Request('http://localhost/api/admin/link-existing-user', { method: 'POST', body: JSON.stringify(body) })
    );

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  });

  it('rechaza poner contraseña a una cuenta cuyo email ya está verificado', async () => {
    setup(existingUser(true));

    const res = await post({ email: EMAIL, password: 'contraseña-del-atacante' });

    expect(res.status).toBe(409);
    // No se toca la cuenta ni se la añade a la organización.
    expect(updateUserById).not.toHaveBeenCalled();
    expect(memberInsert).not.toHaveBeenCalled();
  });

  it('vincula una cuenta verificada SIN tocar su contraseña ni su verificación', async () => {
    setup(existingUser(true));

    const res = await post({ email: EMAIL, fullName: 'Nombre nuevo' });

    expect(res.status).toBe(200);
    expect(memberInsert).toHaveBeenCalled();
    // Si se actualiza algo (p. ej. el nombre en metadatos), nunca credenciales.
    for (const call of updateUserById.mock.calls) {
      const attrs = call[1] as Record<string, unknown>;
      expect(attrs).not.toHaveProperty('password');
      expect(attrs).not.toHaveProperty('email_confirm');
    }
  });

  it('mantiene el rescate de una cuenta SIN verificar: permite contraseña y confirma el email', async () => {
    setup(existingUser(false));

    const res = await post({ email: EMAIL, password: 'contraseña-temporal-1' });

    expect(res.status).toBe(200);
    expect(updateUserById).toHaveBeenCalledWith(
      TARGET_ID,
      expect.objectContaining({ password: 'contraseña-temporal-1', email_confirm: true })
    );
    expect(memberInsert).toHaveBeenCalled();
  });

  it('solo un propietario puede vincular cuentas', async () => {
    setup(existingUser(false), 'member');

    const res = await post({ email: EMAIL });

    expect(res.status).toBe(403);
    expect(updateUserById).not.toHaveBeenCalled();
    expect(memberInsert).not.toHaveBeenCalled();
  });
});
