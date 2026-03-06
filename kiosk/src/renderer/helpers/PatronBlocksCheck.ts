import { toast } from 'react-toastify';

interface PatronBlocksConfig {
  express_patron_blocks: boolean[];
  express_patron_block_patronexpired?: boolean;
  express_patron_block_feeamountlimit?: boolean;
  express_patron_block_chargedmountlimit?: boolean;
  express_patron_block_overdueitemslimit?: boolean;
  express_patron_block_holditemslimit?: boolean;
}

/**
 * Run patron blocks check against SIP2
 * @param licenseId - The license ID
 * @param patronId - The patron ID to check
 * @param branchCode - The branch code
 * @param config - Patron blocks configuration from device config
 * @param t - Translation function (optional)
 * @param openErrorView - Error view function to display errors (optional)
 * @returns Boolean indicating if patron is allowed (true) or blocked (false)
 */
export async function runPatronBlocksCheck(
  licenseId: number,
  patronId: string,
  branchCode: string,
  config: PatronBlocksConfig,
  t?: (key: string) => string,
  openErrorView?: (duration?: number, message?: string) => void
): Promise<boolean> {
  try {
    const patronInfo = {
      patronStatus: 'YYYY      Y   ',
      feeAmount: 100,
      feeLimit: 100,
      PY: 'Y',
      holdItemsCount: 100,
      holdItemsLimit: 100,
      chargedItemsCount: 100,
      chargedItemsLimit: 100,
      overdueItemsCount: 100,
      overdueItemsLimit: 100,
    }

    let isBlocked = false;
    let first = true;
    let restrictionsMessageText = `Patron ID ${patronId} locker usage is blocked due following restrictions`;

    // Check patron status flags (positions 0-13)
    for (let i = 0; i <= 13; i++) {
      if (patronInfo?.patronStatus && config.express_patron_blocks[i] && patronInfo.patronStatus[i] === 'Y') {
        // "patronStatus": "YYYY      Y   "
        isBlocked = true;
        const key = `EXPRESS_MODE_STAFF_PATRON_KEY_${i}`;
        const translatedKey = t ? t(key) : `Position ${i}`;
        restrictionsMessageText =
          restrictionsMessageText +
          (first ? `: ${translatedKey}` : `, ${translatedKey}`);
        first = false;
      }
    }

    // Check if patron is expired
    if (config.express_patron_block_patronexpired && patronInfo?.PY) {
      if (patronInfo.PY.toUpperCase() === 'Y') {
        isBlocked = true;
        restrictionsMessageText =
          restrictionsMessageText +
          (first ? `: PatronID ${patronId} is expired` : `, PatronID ${patronId} is expired`);
        first = false;
      }
    }

    // Check fee amount limit
    if (config.express_patron_block_feeamountlimit && patronInfo.feeAmount && patronInfo.feeLimit) {
      if (+patronInfo.feeAmount > +patronInfo.feeLimit) {
        isBlocked = true;
        restrictionsMessageText =
          restrictionsMessageText +
          (first ? `: PatronID ${patronId} fee amount is exceeded` : `, Fee amount is exceeded`);
        first = false;
      }
    }

    // Check charged items limit
    if (config.express_patron_block_chargedmountlimit && patronInfo.chargedItemsCount && patronInfo.chargedItemsLimit) {
      if (+patronInfo.chargedItemsCount > +patronInfo.chargedItemsLimit) {
        isBlocked = true;
        restrictionsMessageText =
          restrictionsMessageText +
          (first ? `: PatronID ${patronId} charged amount is exceeded` : `, Charged amount is exceeded`);
        first = false;
      }
    }

    // Check overdue items limit
    if (config.express_patron_block_overdueitemslimit && patronInfo.overdueItemsLimit && patronInfo.overdueItemsCount) {
      if (+patronInfo.overdueItemsCount > +patronInfo.overdueItemsLimit) {
        isBlocked = true;
        restrictionsMessageText =
          restrictionsMessageText +
          (first ? `: PatronID ${patronId} overdue count is exceeded` : `, Overdue count is exceeded`);
        first = false;
      }
    }

    // Check hold items limit
    if (config.express_patron_block_holditemslimit && patronInfo.holdItemsCount && patronInfo.holdItemsLimit) {
      if (+patronInfo.holdItemsCount > +patronInfo.holdItemsLimit) {
        isBlocked = true;
        restrictionsMessageText =
          restrictionsMessageText +
          (first ? `: PatronID ${patronId} hold count is exceeded` : `, Hold count is exceeded`);
        first = false;
      }
    }

    if (isBlocked) {
      if (openErrorView) {
        openErrorView(6000, restrictionsMessageText);
      } else {
        setTimeout(() => toast.error(restrictionsMessageText), 100);
      }
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error checking patron blocks:', error);
    if (openErrorView) {
      openErrorView(6000, 'Failed to check patron blocks, please try again');
    } else {
      toast.error('Failed to check patron blocks, please try again');
    }
    return false;
  }
}
