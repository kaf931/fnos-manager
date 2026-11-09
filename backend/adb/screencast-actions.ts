import { AndroidScreenPowerMode, type ScrcpyControlMessageWriter } from '@yume-chan/scrcpy';
import type { AdbScreenAction } from '../domain/adb.js';

type ActionController = Pick<ScrcpyControlMessageWriter, 'setScreenPowerMode' | 'rotateDevice'>;
/** All actions stay on the authenticated scrcpy control channel. */
export async function dispatchScreenAction(
  controller: ActionController,
  action: AdbScreenAction,
): Promise<void> {
  switch (action) {
    case 'display-off':
      await controller.setScreenPowerMode(AndroidScreenPowerMode.Off);
      break;
    case 'display-on':
      await controller.setScreenPowerMode(AndroidScreenPowerMode.Normal);
      break;
    case 'rotate':
      await controller.rotateDevice();
      break;
    default: {
      const invalid: never = action;
      throw new Error(`无效设备操作：${invalid}`);
    }
  }
}
