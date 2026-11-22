import { z } from 'zod';
import { getProcedure, listProcedures, updateProcedure, getRun, listRuns, changeStepState, NotAuthorizedError, RecipeConflictError, createProcedure, deleteProcedure, restoreProcedure, listDeletedProcedures, startRun, completeRun, abortRun, createSchedule, type ProcedureInput } from '@vergissmeinnicht/application';
import { PROCEDURE_ICONS, RECURRENCE_UNITS, RUN_STATES, type ProcedureId, type RunId, type RunStepId, type RunDetail } from '@vergissmeinnicht/domain';
import { define, destructive, isoDate, procedureView, reminderView, revision, uuid, workspace, type AssistantTool } from './shared.ts';

/** Procedures and Runs (48.4): whole Procedures are written as one save; historical Runs never change with them. */
const stepInput = z.strictObject({
  id: uuid.optional().describe('Keep the id of an existing Step from get_procedure; omit for a new Step.'),
  title: z.string().min(1).max(200), description: z.string().max(16000).default(''),
  required: z.boolean().default(false), critical: z.boolean().default(false),
});
const sectionInput = z.strictObject({
  id: uuid.optional().describe('Keep the id of an existing Section; omit for a new one.'),
  title: z.string().min(1).max(200), description: z.string().max(4000).default(''),
  steps: z.array(stepInput).max(200),
});
const sections = z.array(sectionInput).min(1).max(50).describe('The complete ordered Sections with their Steps. Anything left out is removed from the Procedure (never from past Runs).');
type Detail = Awaited<ReturnType<typeof getProcedure>>;
/** Builds the save from the assistant's structure; existing Steps keep what the assistant does not see (icon, photo, reason rules). */
function structure(input: z.output<typeof sections>, current: Detail | undefined): ProcedureInput['sections'] {
  const knownSections = new Map(current?.sections.map((section) => [section.id as string, section]) ?? []);
  const knownSteps = new Map(current?.sections.flatMap((section) => section.steps.map((step) => [step.id as string, step] as const)) ?? []);
  return input.map((section) => ({
    ...(section.id === undefined ? {} : { id: section.id }), title: section.title, description: section.description,
    icon: section.id === undefined ? null : (knownSections.get(section.id)?.icon ?? null),
    steps: section.steps.map((step) => {
      const known = step.id === undefined ? undefined : knownSteps.get(step.id);
      return {
        ...(step.id === undefined ? {} : { id: step.id }), title: step.title, description: step.description, required: step.required, critical: step.critical,
        icon: known?.icon ?? null, skipReasonPolicy: known?.skipReasonPolicy ?? 'OPTIONAL', notApplicableReasonPolicy: known?.notApplicableReasonPolicy ?? 'OPTIONAL',
        ...(known?.image ? { image: known.image } : {}),
      };
    }),
  }));
}
const runView = (detail: RunDetail) => ({
  id: detail.run.id, title: detail.run.title, state: detail.run.state, revision: detail.run.revision,
  sections: detail.sections.map((section) => ({ id: section.id, title: section.title, steps: section.steps.map((step) => ({ id: step.id, title: step.title, state: step.state, required: step.required })) })),
});

export const proceduresTools: AssistantTool[] = [
 define('list_procedures','List reusable Procedures; does not start a Run.','procedures.read','PROCEDURES',false,workspace,async({services,actor,workspaceId})=>({procedures:(await listProcedures(services.procedures,{actor,workspaceId})).map(p=>({id:p.id,title:p.title,revision:p.revision}))})),
 define('get_procedure','Read a Procedure and stable Section/Step ids before editing.','procedures.read','PROCEDURES',false,{...workspace,procedureId:uuid},async({services,actor,workspaceId},input)=>procedureView(await getProcedure(services.procedures,{actor,workspaceId,procedureId:input.procedureId as ProcedureId}))),
 define('add_procedure_step','Append one Step to a specific Section at the reviewed Procedure revision. Requires current editor rights. Never changes a historical Run.','procedures.write','PROCEDURES',true,{...workspace,procedureId:uuid,sectionId:uuid,expectedRevision:revision,title:z.string().min(1).max(200),description:z.string().max(16000).default(''),required:z.boolean().default(false)},async({services,actor,workspaceId},input)=>{
  const procedureId=input.procedureId as ProcedureId;const detail=await getProcedure(services.procedures,{actor,workspaceId,procedureId});if(detail.procedure.revision!==input.expectedRevision)throw new RecipeConflictError();if(!detail.sections.some(section=>section.id===input.sectionId))throw new NotAuthorizedError();
  const result=await updateProcedure(services.procedures,{actor,workspaceId,procedureId,expectedRevision:input.expectedRevision,content:{...detail.procedure,sections:detail.sections.map(section=>({...section,steps:section.id===input.sectionId?[...section.steps,{title:input.title,description:input.description,required:input.required,icon:null,critical:false,skipReasonPolicy:'OPTIONAL',notApplicableReasonPolicy:'OPTIONAL'}]:section.steps}))}});return procedureView(result);
 }),
 define('list_active_runs','List active execution snapshots; choose the actual Run before marking a Step done.','runs.read','PROCEDURES',false,{...workspace,before:uuid.optional()},async({services,actor,workspaceId},input)=>{const page=await listRuns(services.runs,{actor,workspaceId,state:'ACTIVE',before:input.before});return {runs:page.items.map(item=>({id:item.run.id,title:item.run.title,revision:item.run.revision,stepCounts:item.stepCounts})),nextCursor:page.nextCursor};}),
 define('get_run','Read a Run snapshot and actual RunStep ids/states.','runs.read','PROCEDURES',false,{...workspace,runId:uuid},async({services,actor,workspaceId},input)=>{const detail=await getRun(services.runs,{actor,workspaceId,runId:input.runId as RunId});return {id:detail.run.id,title:detail.run.title,state:detail.run.state,revision:detail.run.revision,sections:detail.sections.map(section=>({id:section.id,title:section.title,steps:section.steps.map(step=>({id:step.id,title:step.title,description:step.description,state:step.state,required:step.required,critical:step.critical}))}))};}),
 define('complete_run_step','Mark one actual RunStep done with its reviewed prior state. Keep operationId unchanged on retries. Does not complete the Run.','runs.write','PROCEDURES',true,{...workspace,runId:uuid,stepId:uuid,expectedState:z.enum(['PENDING','DONE','SKIPPED','NOT_APPLICABLE']),operationId:uuid},async({services,actor,workspaceId},input)=>{const result=await changeStepState(services.runs,{actor,workspaceId,runId:input.runId as RunId,stepId:input.stepId as RunStepId,expectedState:input.expectedState,to:'DONE',offline:{clientChangeId:input.operationId,madeBy:actor.id}});return {stepId:result.step.id,state:result.step.state,runRevision:result.runRevision,duplicate:result.duplicate};}),
 define('create_procedure','Create a reusable Procedure (a checklist with Sections and Steps) when the user asks. List Procedures first so nothing is created twice; after a not_confirmed answer, list again before retrying.','procedures.write','PROCEDURES',true,{...workspace,title:z.string().min(1).max(200),description:z.string().max(16000).default(''),icon:z.enum(PROCEDURE_ICONS).default('checklist'),tags:z.array(z.string().min(1).max(40)).max(10).default([]),sections},async({services,actor,workspaceId},input)=>{
  const detail=await createProcedure(services.procedures,{actor,workspaceId,content:{title:input.title,description:input.description,icon:input.icon,tags:input.tags,sections:structure(input.sections,undefined)}});
  return {outcome:'CREATED',procedure:procedureView(detail)};
 }),
 define('save_procedure','Rewrite a Procedure at the revision read with get_procedure: title, description, and the complete ordered Sections and Steps (keep ids of what stays; leave out what should go; reorder by order). Fields left out at the top stay. Runs already started keep their own copy.','procedures.write','PROCEDURES',true,{...workspace,procedureId:uuid,expectedRevision:revision,title:z.string().min(1).max(200).optional(),description:z.string().max(16000).optional(),tags:z.array(z.string().min(1).max(40)).max(10).optional(),sections:sections.optional()},async({services,actor,workspaceId},input)=>{
  const procedureId=input.procedureId as ProcedureId;
  const current=await getProcedure(services.procedures,{actor,workspaceId,procedureId});
  const kept:z.output<typeof sections>=current.sections.map(section=>({id:section.id,title:section.title,description:section.description,steps:section.steps.map(step=>({id:step.id,title:step.title,description:step.description,required:step.required,critical:step.critical}))}));
  const detail=await updateProcedure(services.procedures,{actor,workspaceId,procedureId,expectedRevision:input.expectedRevision,content:{title:input.title??current.procedure.title,description:input.description??current.procedure.description,icon:current.procedure.icon,tags:input.tags??current.procedure.tags,sections:structure(input.sections??kept,current)}});
  return {outcome:'UPDATED',procedure:procedureView(detail)};
 }),
 destructive(define('delete_procedure','Delete a Procedure when the user asks. It is hidden, not destroyed: past Runs stay, and restore_procedure brings it back.','procedures.write','PROCEDURES',true,{...workspace,procedureId:uuid},async({services,actor,workspaceId},input)=>{
  await deleteProcedure(services.procedures,{actor,workspaceId,procedureId:input.procedureId as ProcedureId});
  return {outcome:'DELETED',procedureId:input.procedureId};
 })),
 define('list_deleted_procedures','List deleted Procedures that can be restored.','procedures.read','PROCEDURES',false,workspace,async({services,actor,workspaceId})=>({procedures:(await listDeletedProcedures(services.procedures,{actor,workspaceId})).map(item=>({id:item.procedure.id,title:item.procedure.title,deletedAt:item.deletedAt.toISOString(),deletedBy:item.deletedBy.displayName}))})),
 define('restore_procedure','Bring a deleted Procedure back.','procedures.write','PROCEDURES',true,{...workspace,procedureId:uuid},async({services,actor,workspaceId},input)=>({outcome:'RESTORED',procedure:procedureView(await restoreProcedure(services.procedures,{actor,workspaceId,procedureId:input.procedureId as ProcedureId}))})),
 define('schedule_procedure','Put a Procedure on the Calendar: once or repeating (e.g. every 3 MONTH), from a date, in the user\'s IANA time zone. Due dates remind people to start a Run; no Run is started now.','procedures.write','PROCEDURES',true,{...workspace,procedureId:uuid,date:isoDate,time:z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),timeZone:z.string().min(1).max(64),recurrence:z.strictObject({kind:z.enum(['ONCE','FIXED','AFTER_COMPLETION']),unit:z.enum(RECURRENCE_UNITS).optional(),interval:z.number().int().min(1).max(365).optional()}).optional()},async({services,actor,workspaceId},input)=>{
  const schedule=await createSchedule(services.schedules,{actor,workspaceId,kind:'PROCEDURE',procedureId:input.procedureId,date:input.date,time:input.time,timeZone:input.timeZone,reminders:[],...(input.recurrence?{recurrence:input.recurrence}:{})});
  return {outcome:'SCHEDULED',schedule:reminderView(schedule)};
 }),
 define('list_runs','List Runs of a Workspace by state (ACTIVE, COMPLETED or ABORTED), newest first; before is the last id of the previous page.','runs.read','PROCEDURES',false,{...workspace,state:z.enum(RUN_STATES).default('ACTIVE'),procedureId:uuid.optional(),before:uuid.optional()},async({services,actor,workspaceId},input)=>{
  const page=await listRuns(services.runs,{actor,workspaceId,state:input.state,procedureId:input.procedureId as ProcedureId|undefined,before:input.before});
  return {runs:page.items.map(item=>({id:item.run.id,title:item.run.title,state:item.run.state,revision:item.run.revision,stepCounts:item.stepCounts})),nextCursor:page.nextCursor};
 }),
 define('start_run','Start a Run of a Procedure when the user is about to do it now. It copies the current Steps; tick them with set_run_step_state. List active Runs first: the user may want to continue one.','runs.write','PROCEDURES',true,{...workspace,procedureId:uuid},async({services,actor,workspaceId},input)=>({outcome:'STARTED',run:runView(await startRun(services.runs,{actor,workspaceId,procedureId:input.procedureId as ProcedureId}))})),
 define('set_run_step_state','Set one RunStep to DONE, SKIPPED, NOT_APPLICABLE or back to PENDING, with its reviewed prior state and a reason where the Step asks for one. Keep operationId unchanged on retries.','runs.write','PROCEDURES',true,{...workspace,runId:uuid,stepId:uuid,expectedState:z.enum(['PENDING','DONE','SKIPPED','NOT_APPLICABLE']),to:z.enum(['PENDING','DONE','SKIPPED','NOT_APPLICABLE']),reason:z.string().max(2000).optional(),operationId:uuid},async({services,actor,workspaceId},input)=>{
  const result=await changeStepState(services.runs,{actor,workspaceId,runId:input.runId as RunId,stepId:input.stepId as RunStepId,expectedState:input.expectedState,to:input.to,reason:input.reason,offline:{clientChangeId:input.operationId,madeBy:actor.id}});
  return {stepId:result.step.id,state:result.step.state,runRevision:result.runRevision,duplicate:result.duplicate};
 }),
 define('complete_run','Complete an active Run when the user finished it. Every required Step must be DONE or NOT_APPLICABLE; otherwise nothing changes and the answer says so.','runs.write','PROCEDURES',true,{...workspace,runId:uuid},async({services,actor,workspaceId},input)=>({outcome:'COMPLETED',run:runView(await completeRun(services.runs,{actor,workspaceId,runId:input.runId as RunId}))})),
 destructive(define('abort_run','Abort an active Run without completing it, with an optional reason, when the user asks. It stays in history as aborted and cannot be resumed.','runs.write','PROCEDURES',true,{...workspace,runId:uuid,reason:z.string().max(2000).optional()},async({services,actor,workspaceId},input)=>({outcome:'ABORTED',run:runView(await abortRun(services.runs,{actor,workspaceId,runId:input.runId as RunId,reason:input.reason}))}))),
];
