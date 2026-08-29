/**
 * These tests assert the EXACT column names sent to Supabase, not just
 * that the functions resolve without throwing. This is the gap the
 * project's own audit flagged: a generic `jest.fn().mockReturnThis()`
 * mock accepts any column name silently, so a rename like `read_at` ->
 * `read` (which genuinely happened in production once — notifications
 * couldn't be marked read for a while, undetected because no test
 * pinned the real column name) would still pass a looser test.
 */
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  subscribeToNotifications,
} from "../notifications-repo";

const REAL_ROW = {
  id: "n1",
  tenant_id: "org1",
  user_id: "u1",
  type: "mentioned",
  title: "Te mencionaron",
  body: "En 'Fix bug': hola",
  related_task_id: "t1",
  actor_id: "u2",
  read_at: null,
  created_at: "2026-08-29T00:00:00.000Z",
};

describe("fetchNotifications", () => {
  it("selects from the real `notifications` table and maps the real column shape", async () => {
    const calls: Record<string, unknown> = {};
    const supabase = {
      from: jest.fn((table: string) => {
        calls.table = table;
        return {
          select: jest.fn((cols: string) => {
            calls.select = cols;
            return {
              eq: jest.fn((col: string, val: unknown) => {
                calls.eqCol = col;
                calls.eqVal = val;
                return {
                  order: jest.fn((col: string, opts: unknown) => {
                    calls.orderCol = col;
                    calls.orderOpts = opts;
                    return {
                      limit: jest.fn(async () => ({ data: [REAL_ROW], error: null })),
                    };
                  }),
                };
              }),
            };
          }),
        };
      }),
    };

    const result = await fetchNotifications(supabase as never, "u1");

    expect(calls.table).toBe("notifications");
    expect(calls.eqCol).toBe("user_id");
    expect(calls.eqVal).toBe("u1");
    expect(calls.orderCol).toBe("created_at");

    // The exact bug class this suite exists to catch: asserting the
    // mapped shape uses the real DB columns, not the never-applied
    // organization_id/event_type/message/read design.
    expect(result).toEqual([
      {
        id: "n1",
        type: "mentioned",
        title: "Te mencionaron",
        body: "En 'Fix bug': hola",
        relatedTaskId: "t1",
        readAt: null,
        createdAt: "2026-08-29T00:00:00.000Z",
      },
    ]);
  });

  it("throws when Supabase returns an error", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ({ data: null, error: new Error("boom") }),
            }),
          }),
        }),
      }),
    };
    await expect(fetchNotifications(supabase as never, "u1")).rejects.toThrow("boom");
  });
});

describe("markNotificationRead", () => {
  it("updates read_at (not a `read` boolean) for the given notification id", async () => {
    const calls: Record<string, unknown> = {};
    const supabase = {
      from: jest.fn(() => ({
        update: jest.fn((payload: Record<string, unknown>) => {
          calls.payload = payload;
          return {
            eq: jest.fn(async (col: string, val: unknown) => {
              calls.eqCol = col;
              calls.eqVal = val;
              return { error: null };
            }),
          };
        }),
      })),
    };

    await markNotificationRead(supabase as never, "n1");

    expect(calls.payload).toHaveProperty("read_at");
    expect(calls.payload).not.toHaveProperty("read");
    expect(typeof (calls.payload as { read_at: unknown }).read_at).toBe("string");
    expect(calls.eqCol).toBe("id");
    expect(calls.eqVal).toBe("n1");
  });
});

describe("markAllNotificationsRead", () => {
  it("updates read_at for the user's unread rows (read_at is null), not a `read` boolean column", async () => {
    const calls: Record<string, unknown> = {};
    const supabase = {
      from: jest.fn(() => ({
        update: jest.fn((payload: Record<string, unknown>) => {
          calls.payload = payload;
          return {
            eq: jest.fn((col: string, val: unknown) => {
              calls.eqCol = col;
              calls.eqVal = val;
              return {
                is: jest.fn(async (col2: string, val2: unknown) => {
                  calls.isCol = col2;
                  calls.isVal = val2;
                  return { error: null };
                }),
              };
            }),
          };
        }),
      })),
    };

    await markAllNotificationsRead(supabase as never, "u1");

    expect(calls.payload).toHaveProperty("read_at");
    expect(calls.eqCol).toBe("user_id");
    expect(calls.eqVal).toBe("u1");
    expect(calls.isCol).toBe("read_at");
    expect(calls.isVal).toBeNull();
  });
});

describe("subscribeToNotifications", () => {
  it("subscribes with a per-user filter and maps INSERT payloads through the real schema", () => {
    let registeredFilter: string | undefined;
    let handler: ((payload: unknown) => void) | undefined;
    const removeChannel = jest.fn();
    const channel = {
      on: jest.fn((_event: string, config: { filter: string }, cb: (payload: unknown) => void) => {
        registeredFilter = config.filter;
        handler = cb;
        return channel;
      }),
      subscribe: jest.fn(() => channel),
    };
    const supabase = {
      channel: jest.fn(() => channel),
      removeChannel,
    };

    const onInsert = jest.fn();
    const unsubscribe = subscribeToNotifications(supabase as never, "u1", onInsert);

    expect(registeredFilter).toBe("user_id=eq.u1");

    handler!({ new: REAL_ROW });
    expect(onInsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "n1", readAt: null, relatedTaskId: "t1" })
    );

    unsubscribe();
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });
});
