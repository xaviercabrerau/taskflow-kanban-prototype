import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import * as XLSX from 'xlsx';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

import { POST as importTasks } from '../route';
import { createClient } from '@/lib/supabase/server';

function makeXlsxFile(rows: Record<string, unknown>[]): File {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Tareas");
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new File([buffer], 'tareas.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function makeFormDataRequest(file: File, boardId: string): Request {
  const form = new FormData();
  form.append('file', file);
  form.append('boardId', boardId);
  return new Request('http://localhost:3000/api/admin/import-tasks', {
    method: 'POST',
    body: form,
  });
}

describe('POST /api/admin/import-tasks', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chainable Supabase query builder mock
  let mockSupabase: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = {
      auth: { getUser: jest.fn() },
      from: jest.fn(),
    };
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  it('returns 401 without a session', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: new Error('no') });
    const file = makeXlsxFile([{ 'Título': 'x', 'Estado': 'To Do' }]);
    const response = await importTasks(makeFormDataRequest(file, 'board-1'));
    expect(response.status).toBe(401);
  });

  it('returns 403 when the caller is not the org owner', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'organization_members') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { organization_id: 'org-1', org_role: 'member' },
            error: null,
          }),
        };
      }
      return {};
    });
    const file = makeXlsxFile([{ 'Título': 'x', 'Estado': 'To Do' }]);
    const response = await importTasks(makeFormDataRequest(file, 'board-1'));
    expect(response.status).toBe(403);
  });

  it('creates valid rows and reports invalid ones, matching board columns', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    const insertedRows: unknown[] = [];
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'organization_members') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { organization_id: 'org-1', org_role: 'owner' },
            error: null,
          }),
        };
      }
      if (table === 'boards') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { id: 'board-1', tenant_id: 'org-1' },
            error: null,
          }),
        };
      }
      if (table === 'board_columns') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({
            data: [{ id: 'col-todo', label: 'To Do' }],
            error: null,
          }),
        };
      }
      if (table === 'tasks') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({ data: [], error: null }),
          insert: jest.fn().mockImplementation((rows: unknown[]) => {
            insertedRows.push(...rows);
            return Promise.resolve({ error: null });
          }),
        };
      }
      return {};
    });

    const file = makeXlsxFile([
      { 'Título': 'Tarea válida', 'Estado': 'To Do', 'Prioridad': 'Alta' },
      { 'Título': '', 'Estado': 'To Do' },
    ]);
    const response = await importTasks(makeFormDataRequest(file, 'board-1'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.created).toBe(1);
    expect(json.errors).toEqual([{ row: 2, reason: 'Título es obligatorio' }]);
    expect(insertedRows).toHaveLength(1);
  });

  it('rejects a file with more than 500 data rows', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'organization_members') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { organization_id: 'org-1', org_role: 'owner' },
            error: null,
          }),
        };
      }
      if (table === 'boards') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { id: 'board-1', tenant_id: 'org-1' },
            error: null,
          }),
        };
      }
      return {};
    });

    const rows = Array.from({ length: 501 }, (_, i) => ({ 'Título': `Tarea ${i}`, 'Estado': 'To Do' }));
    const file = makeXlsxFile(rows);
    const response = await importTasks(makeFormDataRequest(file, 'board-1'));
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.error).toBe('Máximo 500 filas por archivo.');
  });
});
