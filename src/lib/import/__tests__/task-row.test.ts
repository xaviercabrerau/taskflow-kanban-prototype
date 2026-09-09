import { describe, it, expect } from '@jest/globals';
import { validateTaskRow, excelSerialToISODate } from '../task-row';

describe('excelSerialToISODate', () => {
  it('converts a known Excel serial date to YYYY-MM-DD', () => {
    // 45910 = 2025-09-10 in Excel's 1900 date system
    expect(excelSerialToISODate(45910)).toBe('2025-09-10');
  });

  it('returns null for an invalid serial number', () => {
    expect(excelSerialToISODate(NaN)).toBeNull();
  });
});

describe('validateTaskRow', () => {
  const columnMap = new Map([
    ['to do', 'col-todo-id'],
    ['en progreso', 'col-progress-id'],
  ]);

  it('parses a fully valid row', () => {
    const result = validateTaskRow(
      {
        'Título': 'Enviar propuesta',
        'Estado': 'To Do',
        'Prioridad': 'Alta',
        'Asignado': 'Ana Torres',
        'Etiqueta': 'ventas',
        'Fecha inicio': '2026-09-10',
        'Fecha vencimiento': '2026-09-15',
      },
      1,
      columnMap
    );
    expect(result.error).toBeUndefined();
    expect(result.row).toEqual({
      title: 'Enviar propuesta',
      columnId: 'col-todo-id',
      priority: 'high',
      assignee: 'Ana Torres',
      tag: 'ventas',
      startDate: '2026-09-10',
      dueDate: '2026-09-15',
    });
  });

  it('defaults priority to medium when empty', () => {
    const result = validateTaskRow(
      { 'Título': 'Tarea sin prioridad', 'Estado': 'To Do' },
      2,
      columnMap
    );
    expect(result.error).toBeUndefined();
    expect(result.row?.priority).toBe('medium');
  });

  it('reports an error when Título is empty', () => {
    const result = validateTaskRow({ 'Título': '  ', 'Estado': 'To Do' }, 3, columnMap);
    expect(result.row).toBeUndefined();
    expect(result.error).toEqual({ row: 3, reason: 'Título es obligatorio' });
  });

  it('reports an error when Estado does not match any column', () => {
    const result = validateTaskRow(
      { 'Título': 'Tarea', 'Estado': 'Columna Inexistente' },
      4,
      columnMap
    );
    expect(result.error?.reason).toBe(
      'Estado "Columna Inexistente" no coincide con ninguna columna del tablero'
    );
  });

  it('reports an error when Prioridad is not recognized', () => {
    const result = validateTaskRow(
      { 'Título': 'Tarea', 'Estado': 'To Do', 'Prioridad': 'Crítica' },
      5,
      columnMap
    );
    expect(result.error?.reason).toBe(
      'Prioridad "Crítica" no reconocida (usa Baja/Media/Alta/Urgente)'
    );
  });

  it('reports an error when a date string is malformed', () => {
    const result = validateTaskRow(
      { 'Título': 'Tarea', 'Estado': 'To Do', 'Fecha inicio': '10/09/2026' },
      6,
      columnMap
    );
    expect(result.error?.reason).toBe(
      'Fecha inicio "10/09/2026" no tiene un formato válido (usa AAAA-MM-DD)'
    );
  });

  it('accepts an Excel serial number as a date', () => {
    const result = validateTaskRow(
      { 'Título': 'Tarea', 'Estado': 'To Do', 'Fecha inicio': 45910 },
      7,
      columnMap
    );
    expect(result.error).toBeUndefined();
    expect(result.row?.startDate).toBe('2025-09-10');
  });

  it('concatenates multiple errors on the same row with "; "', () => {
    const result = validateTaskRow({ 'Título': '', 'Estado': 'Nope' }, 8, columnMap);
    expect(result.error?.reason).toBe(
      'Título es obligatorio; Estado "Nope" no coincide con ninguna columna del tablero'
    );
  });
});
