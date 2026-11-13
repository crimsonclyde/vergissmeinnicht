import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {UUID_V4} from '@vergissmeinnicht/domain';
import type {AppServices} from '../composition.ts';
import {requireUser} from './session.ts';
import {InvalidRequestError} from './errors.ts';
import {NotAuthorizedError} from '@vergissmeinnicht/application';
import {CHATGPT_EXTRA_FILE_HOST} from '@vergissmeinnicht/domain';
import {McpFileHostError} from '@vergissmeinnicht/database';

const uuid=z.string().regex(UUID_V4);
const grantParams=z.strictObject({grantId:uuid});
function actor(request:FastifyRequest){if(!request.principal)throw new Error('Missing principal');return request.principal.user;}
const hostBody=z.strictObject({host:z.string().max(253).regex(CHATGPT_EXTRA_FILE_HOST)});
function host(request:FastifyRequest){const parsed=hostBody.safeParse(request.body);if(!parsed.success)throw new InvalidRequestError();return parsed.data.host;}
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
 // ChatGPT file hosts (36.25): hosts VMN refused, allowed with one tap; only a host VMN reported can be allowed.
 app.get('/file-hosts',async request=>({hosts:await services.mcpFileHosts.list(actor(request))}));
 app.post('/file-hosts/allow',{bodyLimit:512},async(request,reply)=>{
  try{await services.mcpFileHosts.allow(actor(request),host(request));}
  catch(error){if(error instanceof McpFileHostError)return reply.code(409).send({error:error.code});throw error;}
  return {allowed:true};
 });
 app.post('/file-hosts/remove',{bodyLimit:512},async request=>{await services.mcpFileHosts.remove(actor(request),host(request));return {removed:true};});
 app.post('/:grantId/revoke',{bodyLimit:256},async request=>{await services.mcp.revokeAny(actor(request),params(request));return {revoked:true};});
}
