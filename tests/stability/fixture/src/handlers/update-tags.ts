import { tags } from '../services/tags';

export async function updateTags(req: { params: { id: string }; body: { tags?: unknown } }) {
  if (!Array.isArray(req.body.tags)) return { status: 400, body: 'tags must be a list' };
  for (const tag of req.body.tags) {
    if (typeof tag !== 'string') return { status: 400, body: 'every tag must be a string' };
  }
  return { status: 200, body: await tags.replace(req.params.id, req.body.tags) };
}
