import { canAuthenticate, type User, type UserId } from '@vergissmeinnicht/domain';
import { NotAuthorizedError } from './invitations/errors.ts';

export interface PersonalProgress { readonly points: number }
export interface ProgressRepository { read(userId: UserId): Promise<PersonalProgress | undefined> }
/** Own-account aggregate only: never a person selector or a Workspace activity feed. */
export async function personalProgress(repository: ProgressRepository, user: User): Promise<PersonalProgress> {
  if (!canAuthenticate(user)) throw new NotAuthorizedError();
  const progress = await repository.read(user.id);
  if (progress === undefined) throw new NotAuthorizedError();
  return progress;
}
