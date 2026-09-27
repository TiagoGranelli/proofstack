import { lazyFormSchema } from '#/components/form/lazy-schema.ts'

/** The post forms' schema (./post-draft.ts), shared by the composer and the editor and loaded on first use. */
export const postDraftSchema = lazyFormSchema(() => import('./post-draft.ts').then((module) => module.PostDraft))
