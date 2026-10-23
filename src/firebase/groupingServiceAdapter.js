import {
  addAnimeToGroup,
  createGroup,
  deleteGroup,
  removeAnimeFromGroup,
  renameGroup,
  subscribeToGroupMetadata,
  updateGroup,
} from "./firestore";

export const defaultAnimeGroupingServices = Object.freeze({
  addAnimeToGroup,
  createGroup,
  deleteGroup,
  removeAnimeFromGroup,
  renameGroup,
  subscribeToGroupMetadata,
  updateGroup,
});
