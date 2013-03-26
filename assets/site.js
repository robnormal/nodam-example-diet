/*jshint jquery: true */

window.diet = {};

jQuery(function($) {
	$.fn.up = function(selector) {
		var it = this;
		while (! it.is(selector)) {
			it = it.parent();
		}

		return it;
	};

	$('[name="delete"]').click(function() {
		return confirm('Are you sure you want to delete this?');
	});

	$('form tr').on('keydown', 'input[type="text"]', function(ev) {
		// fix annoying table-form behavior
		var code = (ev.keyCode ? ev.keyCode : ev.which);

		if (code == 13) {
			$(this).up('tr').find('button').first().click();
			return ev.preventDefault();
		}
	});

	$('th:contains("Grams"), th:contains("grams")').click(function() {
		var
			$this = $(this),
			place = $this.prevAll().length,
			table = $this.up('table'),
			col   = table.find('tr').find('td:eq(' + place + ')');

		var constants = {
			gramsoz: 0.035274,
			ozlb: 1 / 16,
			lbgrams: 453.592
		};

		var digits = {
			grams: 0,
			oz: 1,
			lb: 2
		};

		var toDigits = function(digs, n) {
			var mult = 1, i = 0;

			for(; i < digs; i++) {
				mult *= 10;
			}

			return Math.round(n * mult) / mult;
		};

		var unitChange = function(a, b) {
			return function(_, td) {
				var
					$td = $(td),
					html = $td.data(a + 'html') ?  $td.data(a + 'html') : $td.html(),
					toHtml = $td.data(b + 'html') ?  $td.data(b + 'html') : null,
					text = $td.text(),
					input = $td.find('input'),
					value = input.attr('value'),
					anum = $td.data(a) ?  $td.data(a) : parseFloat(value || text),
					bnum = $td.data(b) ?  $td.data(b) : anum * constants[a + b];

				$td.data(a + 'html', html);

				if ($.isNumeric(anum)) {
					$td.data(a, anum);

					if ($.isNumeric(bnum)) {
						$td.data(b, bnum);

						if (toHtml) {
							$td.html(toHtml);
						} else {
							var bnew = toDigits(digits[b], bnum);

							if (input.length) {
								input.attr('value', bnum).attr('name', input.attr('name') + b);
							} else {
								$td.text(bnew);
							}
						}
					}
				}
			}
		};

		var f;
		if ($this.text().match(/grams/i)) {

			$this.text($this.text().replace(/grams/i, 'oz'));
			col.each(unitChange('grams', 'oz'));

		} else if ($this.text().match(/oz/i)) {

			$this.text($this.text().replace(/oz/i, 'lb'));
			col.each(unitChange('oz', 'lb'));

		} else if ($this.text().match(/lb/i)) {

			$this.text($this.text().replace(/lb/i, 'grams'));
			col.each(unitChange('lb', 'grams'));

		}
	});
});

