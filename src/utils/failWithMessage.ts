import * as core from '@actions/core';

export const failWithMessage = (message: string): never => {
  core.setFailed(message);
  throw new Error('Process will be terminated.');
};
