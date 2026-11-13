import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {UUID_V4} from '@vergissmeinnicht/domain';
import type {AppServices} from '../composition.ts';
import {requireUser} from './session.ts';
import {InvalidRequestError} from './errors.ts';
import {NotAuthorizedError} from '@vergissmeinnicht/application';

const uuid=z.string().regex(UUID_V4);
const grantParams=z.strictObject({grantId:uuid});
function actor(request:FastifyRequest){if(!request.principal)throw new Error('Missing principal');return request.principal.user;}
function params(request:FastifyRequest){const parsed=grantParams.safeParse(request.params);if(!parsed.success)throw new InvalidRequestError();return parsed.data.grantId;}

/**
 * Server admin → AI connections (36.24): every connection on the server and ending any of them.
 * Grants stay immutable (0064 trigger); a different scope means a new connection. The repository checks the server-admin flag in
 * the same transaction; a disabled MCP server answers 404 like the account routes.
 */
export async function mcpAdminRoutes(app:FastifyInstance,{services}:{services:AppServices}){
 app.addHook('preHandler',requireUser(services));
 // Non-admins learn nothing, not even whether MCP is on; the repository checks the flag again.
 app.addHook('preHandler',async request=>{if(!actor(request).serverAdmin)throw new NotAuthorizedError();});
 app.addHook('preHandler',async(_request,reply)=>{if(!services.mcpEnabled)return reply.code(404).send({error:'not_found'});});
 app.get('/',async request=>({connections:await services.mcp.allConnections(actor(request))}));
 app.post('/:grantId/revoke',{bodyLimit:256},async request=>{await services.mcp.revokeAny(actor(request),params(request));return {revoked:true};});
}
