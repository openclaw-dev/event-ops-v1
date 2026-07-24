/**
 * supabase-mock.ts
 *
 * A tiny chainable stand-in for the Supabase JS client used in unit tests. It
 * supports the query-builder surface our code actually calls
 * (select/insert/update/upsert/delete + eq/in/is/not/order/limit/range/lt/gte +
 * single/maybeSingle + await), routing every terminal call to a user-supplied
 * router that returns { data, error }. A `record` callback captures each
 * terminal QueryCtx so tests can assert what was written.
 */

export interface QueryCtx {
  table: string;
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  filters: Record<string, unknown>;
  payload?: unknown;
  options?: unknown;
  terminal: 'await' | 'single' | 'maybeSingle';
}

export interface MockResult {
  data: unknown;
  error: unknown;
}

export type Router = (ctx: QueryCtx) => MockResult;

/* eslint-disable @typescript-eslint/no-explicit-any */
export function makeAdmin(router: Router, record?: (ctx: QueryCtx) => void): any {
  function builder(table: string): any {
    const ctx: QueryCtx = { table, op: 'select', filters: {}, terminal: 'await' };

    const settle = (terminal: QueryCtx['terminal']): MockResult => {
      ctx.terminal = terminal;
      record?.(ctx);
      return router(ctx);
    };

    const b: any = {
      select: () => b,
      insert: (p: unknown) => {
        ctx.op = 'insert';
        ctx.payload = p;
        return b;
      },
      update: (p: unknown) => {
        ctx.op = 'update';
        ctx.payload = p;
        return b;
      },
      upsert: (p: unknown, o: unknown) => {
        ctx.op = 'upsert';
        ctx.payload = p;
        ctx.options = o;
        return b;
      },
      delete: () => {
        ctx.op = 'delete';
        return b;
      },
      eq: (c: string, v: unknown) => {
        ctx.filters[c] = v;
        return b;
      },
      in: (c: string, v: unknown) => {
        ctx.filters[c] = v;
        return b;
      },
      is: (c: string, v: unknown) => {
        ctx.filters[c] = v;
        return b;
      },
      not: () => b,
      order: () => b,
      limit: () => b,
      range: () => b,
      lt: (c: string, v: unknown) => {
        ctx.filters[c] = v;
        return b;
      },
      gte: (c: string, v: unknown) => {
        ctx.filters[c] = v;
        return b;
      },
      maybeSingle: async () => settle('maybeSingle'),
      single: async () => settle('single'),
      then: (resolve: any, reject: any) =>
        Promise.resolve(settle('await')).then(resolve, reject),
    };
    return b;
  }

  return { from: (t: string) => builder(t) };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
