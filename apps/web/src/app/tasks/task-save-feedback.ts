export function getTaskSaveSuccessMessage(isEdit: boolean) {
  return isEdit ? "Task updated." : "Task created.";
}
