(function () {
  'use strict';
  window.Monetize = {
    init: async function () {},
    isAdFree: function () { return true; },
    unlockFeature: async function () { return { ok: true, source: 'open-source' }; },
    showRewardedAd: async function () { return false; },
    buyRemoveAds: async function () { return { ok: true, message: '此開源版本無廣告與內購' }; },
    restorePurchases: async function () { return { ok: true, message: '此開源版本不需要購買' }; },
    removeAdsPrice: function () { return ''; }
  };
})();
