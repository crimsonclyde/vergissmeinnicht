import {askBrowserTest} from './ask-browser.ts';
import {serverEnv} from '../playwright.config.ts';
askBrowserTest(serverEnv,false);
