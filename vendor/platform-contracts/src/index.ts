import { initTRPC } from '@trpc/server';
import { z } from 'zod';
export const username = z.string().trim().toLowerCase().min(3).max(30).regex(/^[a-z0-9_]+$/);
const id = z.string().uuid();
const entityType = z.string().min(1).max(80).regex(/^[a-z][a-z0-9_.]*$/);
export const profileSchema = z.object({
  id, username: username.nullable(), displayName: z.string(), revision: z.number(),
  avatarUrl: z.string().nullable(),
  status: z.enum(['active', 'pending_deletion', 'deleting']),
  deleteAfter: z.string().nullable(), createdAt: z.string(),
});
export const entitySchema = z.object({
  id, ownerId: id, type: entityType, title: z.string(), language: z.string(),
  revision: z.number(), createdAt: z.string(), updatedAt: z.string(),
});
export type Entity = z.infer<typeof entitySchema>;
const operation = z.object({ operationId: id });
export const definitions = {
  profile: { input: z.void(), output: profileSchema },
  updateProfile: { input: z.object({ revision: z.number().int().positive(), username, displayName: z.string().trim().min(1).max(100) }).strict(), output: profileSchema },
  requestDeletion: { input: z.object({ confirmation: z.literal('delete my account') }).strict(), output: z.object({ deleteAfter: z.string() }) },
  cancelDeletion: { input: z.void(), output: z.object({ restored: z.literal(true) }) },
  entityCreate: { input: operation.extend({ id, type: entityType, title: z.string().max(500), language: z.string().min(1).max(35).default('und') }).strict(), output: entitySchema },
  entityUpdate: { input: operation.extend({ id, revision: z.number().int().positive(), title: z.string().max(500), language: z.string().min(1).max(35) }).strict(), output: entitySchema },
  entityDelete: { input: operation.extend({ id, revision: z.number().int().positive() }).strict(), output: z.object({ id }) },
  entityGet: { input: z.object({ id }).strict(), output: entitySchema },
  entityList: { input: z.object({ types: z.array(entityType).min(1).max(20), since: z.string().datetime().optional(), limit: z.number().int().min(1).max(100).default(50), before: z.object({ updatedAt: z.string().datetime(), id }).optional() }).strict(), output: z.object({ items: z.array(entitySchema), cursor: z.number().int() }) },
  entityShare: { input: z.object({ id, accountId: id, relation: z.enum(['viewer','editor']) }).strict(), output: z.object({ shared: z.literal(true) }) },
  entityUnshare: { input: z.object({ id, accountId: id }).strict(), output: z.object({ removed: z.literal(true) }) },
  checkAccess: { input: z.object({ id, action: z.enum(['read','edit','share','delete']) }).strict(), output: z.object({ allowed: z.boolean() }) },
  syncPull: { input: z.object({ cursor: z.number().int().nonnegative(), types: z.array(entityType).min(1).max(20), limit: z.number().int().min(1).max(100).default(100) }).strict(), output: z.object({ cursor: z.number().int(), hasMore: z.boolean(), changes: z.array(z.discriminatedUnion('kind', [z.object({ kind: z.literal('upsert'), entity: entitySchema }), z.object({ kind: z.literal('remove'), id })])) }) },
  deleteData: { input: z.object({ type: entityType, confirmation: z.literal('delete my data') }).strict(), output: z.object({ deleted: z.number().int(), jobId: id }) },
  dataSummary: { input: z.void(), output: z.array(z.object({ type: entityType, count: z.number().int() })) },
  deletionStatus: { input: z.void(), output: z.array(z.object({ id, scope: z.union([z.object({ kind: z.literal('account') }), z.object({ kind: z.literal('type'), type: entityType })]), state: z.string(), dueAt: z.string(), attempts: z.number(), lastError: z.string().nullable() })) },
  identityMethods: { input: z.void(), output: z.array(z.object({ provider: z.string() })) },
  sessions: { input: z.void(), output: z.array(z.object({ id: z.string(), current: z.boolean(), userAgent: z.string().nullable(), createdAt: z.string(), status: z.string() })) },
  revokeSession: { input: z.object({ id: z.string().min(1).max(100) }).strict(), output: z.object({ revoked: z.literal(true) }) },
} as const;
export type Method = keyof typeof definitions;
export type Input<K extends Method> = z.input<(typeof definitions)[K]['input']>;
export type ParsedInput<K extends Method> = z.output<(typeof definitions)[K]['input']>;
export type Output<K extends Method> = z.output<(typeof definitions)[K]['output']>;
export interface PlatformContext { workosId: string | null; sessionId?: string }
export type Dispatcher = <K extends Method>(method: K, input: ParsedInput<K>, ctx: PlatformContext) => Promise<Output<K>>;
const t = initTRPC.context<PlatformContext>().create({
  errorFormatter({ shape }) {
    return { ...shape, message: shape.data.code === 'INTERNAL_SERVER_ERROR' ? 'Request failed. Please try again.' : shape.message,
      data: { ...shape.data, stack: undefined } };
  },
});
export function buildRouter(dispatch: Dispatcher) {
  return t.router({
    health: t.procedure.query(() => ({ status: 'ok' as const })),
    profile: t.procedure.input(definitions.profile.input).output(definitions.profile.output).query(({ ctx, input }) => dispatch('profile', input, ctx)),
    updateProfile: t.procedure.input(definitions.updateProfile.input).output(definitions.updateProfile.output).mutation(({ ctx, input }) => dispatch('updateProfile', input, ctx)),
    requestDeletion: t.procedure.input(definitions.requestDeletion.input).output(definitions.requestDeletion.output).mutation(({ ctx, input }) => dispatch('requestDeletion', input, ctx)),
    cancelDeletion: t.procedure.input(definitions.cancelDeletion.input).output(definitions.cancelDeletion.output).mutation(({ ctx, input }) => dispatch('cancelDeletion', input, ctx)),
    entityCreate: t.procedure.input(definitions.entityCreate.input).output(definitions.entityCreate.output).mutation(({ ctx, input }) => dispatch('entityCreate', input, ctx)),
    entityUpdate: t.procedure.input(definitions.entityUpdate.input).output(definitions.entityUpdate.output).mutation(({ ctx, input }) => dispatch('entityUpdate', input, ctx)),
    entityDelete: t.procedure.input(definitions.entityDelete.input).output(definitions.entityDelete.output).mutation(({ ctx, input }) => dispatch('entityDelete', input, ctx)),
    entityGet: t.procedure.input(definitions.entityGet.input).output(definitions.entityGet.output).query(({ ctx, input }) => dispatch('entityGet', input, ctx)),
    entityList: t.procedure.input(definitions.entityList.input).output(definitions.entityList.output).query(({ ctx, input }) => dispatch('entityList', input, ctx)),
    entityShare: t.procedure.input(definitions.entityShare.input).output(definitions.entityShare.output).mutation(({ ctx, input }) => dispatch('entityShare', input, ctx)),
    entityUnshare: t.procedure.input(definitions.entityUnshare.input).output(definitions.entityUnshare.output).mutation(({ ctx, input }) => dispatch('entityUnshare', input, ctx)),
    checkAccess: t.procedure.input(definitions.checkAccess.input).output(definitions.checkAccess.output).query(({ ctx, input }) => dispatch('checkAccess', input, ctx)),
    syncPull: t.procedure.input(definitions.syncPull.input).output(definitions.syncPull.output).query(({ ctx, input }) => dispatch('syncPull', input, ctx)),
    deleteData: t.procedure.input(definitions.deleteData.input).output(definitions.deleteData.output).mutation(({ ctx, input }) => dispatch('deleteData', input, ctx)),
    dataSummary: t.procedure.input(definitions.dataSummary.input).output(definitions.dataSummary.output).query(({ ctx, input }) => dispatch('dataSummary', input, ctx)),
    deletionStatus: t.procedure.input(definitions.deletionStatus.input).output(definitions.deletionStatus.output).query(({ ctx, input }) => dispatch('deletionStatus', input, ctx)),
    identityMethods: t.procedure.input(definitions.identityMethods.input).output(definitions.identityMethods.output).query(({ ctx, input }) => dispatch('identityMethods', input, ctx)),
    sessions: t.procedure.input(definitions.sessions.input).output(definitions.sessions.output).query(({ ctx, input }) => dispatch('sessions', input, ctx)),
    revokeSession: t.procedure.input(definitions.revokeSession.input).output(definitions.revokeSession.output).mutation(({ ctx, input }) => dispatch('revokeSession', input, ctx)),
  });
}
export type AppRouter = ReturnType<typeof buildRouter>;

