import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

import { PUT as updateUser, DELETE as deleteUser } from '../[id]/route';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

// Pruebas de AUTORIZACIÓN de PUT/DELETE /api/admin/users/[id] (hallazgo C de la
// revisión del 2026-10-05): el usuario destino debe pertenecer a la
// organización del owner que llama, el valor de `role` se valida, y un owner
// no se puede degradar ni eliminar por esta API.

const CALLER = { id: 'owner-user' };
const ORG = 'org-123';
const TARGET = 'user-123';
const params = Promise.resolve({ id: TARGET });

type Result = { data: unknown; error: unknown };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- chainable Supabase query builder mock
function membersTable(opts: { maybeSingle: Result[]; admins?: unknown[]; writeError?: unknown }): any {
  let n = 0;
  const writeChain = {
    eq: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: opts.writeError ?? null })) })),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table: any = {
    select: jest.fn(() => table),
    eq: jest.fn(() => table),
    in: jest.fn(() => Promise.resolve({ data: opts.admins ?? [], error: null })),
    maybeSingle: jest.fn(() => Promise.resolve(opts.maybeSingle[Math.min(n++, opts.maybeSingle.length - 1)])),
    update: jest.fn(() => writeChain),
    delete: jest.fn(() => writeChain),
  };
  return table;
}

const ownerMembership = { data: { organization_id: ORG, org_role: 'owner' }, error: null };
const memberTarget = { data: { org_role: 'member', joined_at: '2026-01-01T00:00:00.000Z' }, error: null };
const ownerTarget = { data: { org_role: 'owner', joined_at: '2026-01-01T00:00:00.000Z' }, error: null };
const notFound = { data: null, error: null };

describe('autorización de PUT/DELETE /api/admin/users/[id]', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let supabase: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adminProfilesUpdate: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let members: any;

  function setup(maybeSingle: Result[], admins?: unknown[]) {
    members = membersTable({ maybeSingle, admins });
    supabase = {
      auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: CALLER }, error: null })) },
      from: jest.fn((table: string) => {
        if (table === 'organization_members') return members;
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn(() =>
            Promise.resolve({ data: { id: TARGET, email: 'x@example.com', full_name: 'X' }, error: null })
          ),
        };
      }),
    };
    (createClient as jest.Mock).mockResolvedValue(supabase);
  }

  const put = (body: object) =>
    updateUser(new Request(`http://localhost/api/admin/users/${TARGET}`, { method: 'PUT', body: JSON.stringify(body) }), { params });
  const del = () =>
    deleteUser(new Request(`http://localhost/api/admin/users/${TARGET}`, { method: 'DELETE' }), { params });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    adminProfilesUpdate = jest.fn().mockReturnThis();
    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({ update: adminProfilesUpdate, eq: jest.fn(() => Promise.resolve({ error: null })) })),
    });
  });

  describe('PUT', () => {
    it('no renombra a un usuario que no pertenece a la organización del owner', async () => {
      // 1.ª lectura: owner que llama. 2.ª: el destino NO es miembro de su org.
      setup([ownerMembership, notFound]);

      const res = await put({ name: 'Nombre robado' });

      expect(res.status).toBe(404);
      // Lo importante: el cliente service-role (que se salta RLS) no escribe nada.
      expect(adminProfilesUpdate).not.toHaveBeenCalled();
    });

    it('rechaza un role inventado en vez de convertirlo en member', async () => {
      setup([ownerMembership, memberTarget]);

      const res = await put({ role: 'superuser' });

      expect(res.status).toBe(400);
      expect(members.update).not.toHaveBeenCalled();
    });

    it('no permite cambiar el rol de un propietario', async () => {
      setup([ownerMembership, ownerTarget]);

      const res = await put({ role: 'user' });

      expect(res.status).toBe(409);
      expect(members.update).not.toHaveBeenCalled();
    });

    it('acepta "viewer" (valor que envía la interfaz) y lo guarda como member', async () => {
      setup([ownerMembership, memberTarget, memberTarget]);

      const res = await put({ role: 'viewer' });

      expect(res.status).toBe(200);
      expect(members.update).toHaveBeenCalledWith({ org_role: 'member' });
    });
  });

  describe('DELETE', () => {
    it('no elimina a un usuario que no pertenece a la organización', async () => {
      setup([ownerMembership, notFound]);

      const res = await del();

      expect(res.status).toBe(404);
      expect(members.delete).not.toHaveBeenCalled();
    });

    it('no permite eliminar a otro propietario, aunque haya más admins', async () => {
      // Antes la comprobación contaba admins y owners juntos: con un owner y
      // un admin, se podía borrar al único owner y la org quedaba sin dueño.
      setup([ownerMembership, ownerTarget], [{ user_id: 'owner-user' }, { user_id: TARGET }, { user_id: 'otro-admin' }]);

      const res = await del();

      expect(res.status).toBe(409);
      expect(members.delete).not.toHaveBeenCalled();
    });

    it('elimina a un miembro normal de la organización', async () => {
      setup([ownerMembership, memberTarget], [{ user_id: 'owner-user' }, { user_id: 'otro-admin' }]);

      const res = await del();

      expect(res.status).toBe(200);
      expect(members.delete).toHaveBeenCalled();
    });
  });
});
