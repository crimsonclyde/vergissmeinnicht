import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {MCP_SCOPES,UUID_V4} from '@vergissmeinnicht/domain';
import type {AppServices} from '../composition.ts';
import {requireUser} from './session.ts';
import {InvalidRequestError} from './errors.ts';
const uuid=z.string().regex(UUID_V4);
function actor(request:FastifyRequest){if(!request.principal)throw new Error('Missing principal');return request.principal.user;}
export async function mcpAccountRoutes(app:FastifyInstance,{services}:{services:AppServices}){
 app.addHook('preHandler',requireUser(services));
 app.get('/status',async()=>({enabled:services.mcpEnabled}));
 app.addHook('preHandler',async(request,reply)=>{if(!services.mcpEnabled&&!request.routeOptions.url?.endsWith('/status'))return reply.code(404).send({error:'not_found'});});
 app.get('/',async request=>({connections:await services.mcp.connections(actor(request))}));
 app.get('/requests/:requestId',async request=>{const params=z.object({requestId:uuid}).safeParse(request.params);if(!params.success)throw new InvalidRequestError();return services.mcp.request(actor(request),params.data.requestId);});
 app.post('/approve',{bodyLimit:4096,config:{rateLimit:{max:20,timeWindow:15*60000}}},async request=>{
  const input=z.strictObject({requestId:uuid,allow:z.boolean(),workspaceIds:z.array(uuid).max(32),scopes:z.array(z.enum(MCP_SCOPES)).max(MCP_SCOPES.length)}).safeParse(request.body);if(!input.success)throw new InvalidRequestError();
  return {redirect:await services.mcp.approve(actor(request),input.data.requestId,input.data.workspaceIds,input.data.scopes,input.data.allow)};
 });
 app.post('/:grantId/revoke',{bodyLimit:256},async request=>{const params=z.object({grantId:uuid}).safeParse(request.params);if(!params.success)throw new InvalidRequestError();await services.mcp.revokeOwned(actor(request),params.data.grantId);return {revoked:true};});
}
