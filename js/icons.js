/* Shared decorative SVG icons; text labels remain the accessible names. */
(function () {
  'use strict';

  var names = ['help', 'bag', 'dog', 'box', 'queue', 'truck', 'wrench', 'leaf', 'walk', 'inbox', 'recycle', 'store', 'luggage', 'phone', 'camera', 'meal', 'book', 'money', 'pin', 'shield', 'award', 'check', 'star', 'star-filled', 'play', 'pause'];

  function render(name) {
    var icon = names.indexOf(name) !== -1 ? name : 'book';
    var filled = icon === 'star-filled' ? ' ui-icon-filled' : '';
    return '<svg class="ui-icon' + filled + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#idle-icon-' + icon + '"></use></svg>';
  }

  function ratingStars(rating) {
    var stars = '';
    var value = Number(rating);
    for (var i = 1; i <= 5; i++) {
      stars += render(i <= Math.floor(value) ? 'star-filled' : 'star');
    }
    return '<span class="rating-icons" role="img" aria-label="' + value + ' 顆星">' + stars + '</span>';
  }

  window.IdleIcons = { render: render, ratingStars: ratingStars };
})();
