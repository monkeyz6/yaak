import { atom } from "jotai";

/** Id of a post-response action that was just added via the response-body extract flow */
export const recentlyAddedPostActionIdAtom = atom<string | null>(null);
