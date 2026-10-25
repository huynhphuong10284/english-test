// Preload: exposes a small, safe API to the renderer via contextBridge.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('examApi', {
  listExams: () => ipcRenderer.invoke('exams:list'),
  getExam: (examId) => ipcRenderer.invoke('exams:get', examId),
  submitExam: (examId, answers) => ipcRenderer.invoke('exams:submit', examId, answers),
  getResult: (examId, attemptId) => ipcRenderer.invoke('results:get', examId, attemptId),
  assessWriting: (examId, attemptId, selfAssessment) => ipcRenderer.invoke('results:assess', examId, attemptId, selfAssessment),
  lookupWord: (word) => ipcRenderer.invoke('dict:lookup', word)
});
