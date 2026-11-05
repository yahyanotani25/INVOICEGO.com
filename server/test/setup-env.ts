// Runs in every test worker BEFORE test files import any src module (config is read at import time).
import { applyTestEnv } from './env';
applyTestEnv();
