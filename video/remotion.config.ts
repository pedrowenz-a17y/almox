import {availableParallelism} from 'node:os';
import {Config} from '@remotion/cli/config';

Config.setConcurrency(Math.min(2, availableParallelism()));
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(91);
Config.setX264Preset('veryfast');
Config.setAudioBitrate('192k');
Config.setOverwriteOutput(true);

if (process.env.ALMOX_CHROMIUM) {
  Config.setBrowserExecutable(process.env.ALMOX_CHROMIUM);
}
