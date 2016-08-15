/*
This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
// ======================================================================
// Utilities.
// ======================================================================
var periods = ['ONE_TIME', 'DAILY', 'WEEKLY', 'MONTHLY', 'ANNUALLY'];
var period_names = $.map(periods, function(item, index) {
    return item.toLowerCase()
          .split('_')
          .map(function(i) { return i[0].toUpperCase() + i.substring(1); })
          .join(' ');
});

function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
        return v.toString(16);
    });
};

function isodate(date) {
    if (date == null)
        return undefined;
    if (typeof date === 'string')
        return date.replace(/-0/g, '-');
    var year = date.getFullYear();
    return year + '-' + (date.getMonth()+1) + '-' + date.getDate();
};

function from_isodate(date) {
    if (typeof date === 'object')
        return date;
    if (date == null)
        return undefined;
    var dateTimeParts = date.split("T");
    var dateParts = dateTimeParts[0].split("-");
    return new Date(dateParts[0], (dateParts[1] - 1), dateParts[2]);
};

function validator_required(input) {
    return $.trim(input.val()) !== '';
};

function get_invalid_fields(selector) {
    return selector.filter(function() {
        var validator = $(this).data('validator');
        if (!validator)
            return false;
        return !validator($(this));
    });
};

function get_invalid_field_targets(selector) {
    var invalid = get_invalid_fields(selector);
    return invalid.map(function(index, elem) {
        var target = $(elem).data('validator-target');
        return target ? target.get() : this;
    });
};

function validate_all(selector) {
    var invalid = get_invalid_fields(selector);
    invalid.addClass('error');
    return invalid.length == 0;
};

// ======================================================================
// Backends
// ======================================================================
var SpiffCalendarBackend = function(options) {
    var that = this;

    this.settings = $.extend(true, {
        add_event: function(backend, event_data, success_cb) {},
        save_event: function(backend, event_data, success_cb) {},
        delete_event: function(backend, event_data, success_cb) {},
        split_event: function(backend, split_point, event_data, success_cb) {},
        save_single: function(backend, event_data, success_cb) {},
        delete_single: function(backend, event_data, success_cb) {},
        load_range: function(backend, start_date, end_date, success_cb) {}
    }, options);
    var settings = this.settings;

    // These object hold the cache. event_id_to_date is needed because
    // the cache contains only references, so when the date of an
    // event changes it would be difficult to find it in day_cache
    // for updates.
    this.event_cache = {};
    this.day_cache = {};
    this.event_id_to_date = {};

    // Rest is public API.
    this.cache_event = function(event_data) {
        that.invalidate_event(event_data);

        // Add the event to the event cache.
        var date = isodate(event_data.date);
        that.event_cache[event_data.id] = event_data;
        that.event_id_to_date[event_data.id] = date;

        // Also add it to the day cache.
        var day = that.day_cache[date];
        if (typeof day === "undefined")
            day = that.day_cache[date] = {};
        if (day.events)
            day.events.push(event_data.id);
        else
            day.events = [event_data.id];
    };

    this.cache_day_data = function(date, day_data) {
        date = isodate(date);
        var day = that.day_cache[date];
        if (typeof day === "undefined")
            that.day_cache[date] = day_data;
        else
            $.extend(day, day_data);
    };

    this.invalidate_event = function(event_data) {
        // Remove the old event from the event cache.
        var old_date = that.event_id_to_date[event_data.id];
        if (!old_date)
            return;
        delete that.event_cache[event_data.id];
        delete that.event_id_to_date[event_data.id];

        // Also remove it from the day cache. Since the date may have changed,
        // we need to find the day data using the formerly cached event object.
        var day = that.day_cache[old_date];
        if (!day)
            return;
        var index = day.events.indexOf(event_data.id);
        if (index != -1)
            day.events.splice(index, 1);
    };

    this.invalidate_all = function() {
        that.event_cache = {};
        that.day_cache = {};
        that.event_id_to_date = {};
    };

    this.get_event = function(event_id) {
        // Since the id is already passed, the backend should already
        // know it.
        return that.event_cache[event_id];
    };

    this.get_day_data = function(date) {
        return that.day_cache[date] || {};
    };

    this.get_range = function(start, last, success_cb) {
        var current = new Date(start.getTime());
        while (current <= last) {
            var key = isodate(current);
            if (!that.day_cache.hasOwnProperty(key))
                return settings.load_range(that, current, last, success_cb);
            current.setDate(current.getDate()+1);
        }
        // Great, everything was already in the cache.
        return success_cb();
    };

    this.add_event = settings.add_event;
    this.save_event = settings.save_event;
    this.delete_event = settings.delete_event;
    this.split_event = settings.split_event;
    this.save_single = settings.save_single;
    this.delete_single = settings.delete_single;
    this.load_range = settings.load_range;
};

// ======================================================================
// Calendar
// ======================================================================
var SpiffCalendar = function(div, options) {
    this._div = div;
    var that = this;

    this.settings = $.extend(true, {
        href: undefined,
        period: 'month',
        region: 'en',
        start: undefined,
        last: undefined,
        backend: new SpiffCalendarBackend(),
        event_renderer: undefined,
        footnote_renderer: function(e) { return e; },
        on_move_event: function(event_data, target_date) {
            event_data.date = target_date;
            settings.backend.save_single(settings.backend,
                                         event_data,
                                         that.refresh);
        },
        on_refresh: function() {}
    }, options);
    var settings = this.settings;
    var render_event = settings.event_renderer.render;

    if (this._div.length != 1)
        throw new Error('selector needs to match exactly one element');
    this._div.addClass('SpiffCalendar');
    this._div.data('SpiffCalendar', this);

    this.regional = $.datepicker.regional[settings.region];
    weekdays = this.regional.dayNames;
    weekdays_short = this.regional.dayNamesMin;
    months = this.regional.monthNames;

    this._calendar_event = function(event_data) {
        var html = $('<div class="event"></div>');
        html.data('event', event_data);
        html.append(render_event(that._div, html, event_data));
        return html;
    };

    this.add_event = function(event_data) {
        var date = isodate(event_data.date);
        var day = that._div.find('*[data-date="'+date+'"]:not(.placeholder)');
        var events = day.find('.events');
        var theevent = that._calendar_event(event_data);
        events.append(theevent);
        return theevent;
    };

    this.remove_event = function(event_data) {
        that._div.find('.event').filter(function() {
            return event_data == $(this).data('event');
        }).remove();
    };

    this._calendar_day = function(date) {
        var html = $('\
            <td class="day card hoverable">\
                <div class="wrapper">\
                    <div class="day_number"></div>\
                    <div class="events"></div>\
                    <div class="footnote center"></div>\
                </div>\
            </td>');
        html.droppable({
            accept: function(d) {
                return d.closest('.event').length > 0 && !d.closest('.day').is(this);
            },
            drop: function(e, ui) {
                var event_data = ui.draggable.data('event');
                ui.draggable.remove();
                settings.on_move_event(event_data, $(this).data('date'));
            }
        });

        var year = date.getFullYear();
        var date_str = year + '-' + (date.getMonth()+1) + '-' + date.getDate();
        html.attr('data-date', date_str);
        html.find(".day_number").append(date.getDate());

        today = new Date();
        if (date.toDateString() == today.toDateString())
            html.addClass("today");

        return html;
    };

    this._calendar_week = function(range_start, range_end, date) {
        var html = $('<tr class="week"></tr>');

        var last = new Date(date);
        last.setDate(date.getDate() + 6);

        while(date <= last){
            var day = this._calendar_day(date);
            if (date < range_start || date > range_end)
                day.addClass("filler");
            html.append(day);
            var newDate = date.setDate(date.getDate() + 1);
            date = new Date(newDate);
        }

        return html;
    };

    this.set_period = function(period) {
        if (period == "month")
            settings.period = period;
        else
            settings.period = parseInt(period);
    };

    this.set_range = function(start, last) {
        // Defines the days that the user wants to see. The actual visible
        // range may differ: This range may later be expanded to begin at the
        // a Sunday, for example.
        var today = new Date();
        if (typeof start === "undefined")
            start = new Date(today.getFullYear(),
                             today.getMonth(),
                             today.getDate() - today.getDay());
        if (settings.period == "month")
            settings.start = new Date(start.getFullYear(),
                                      start.getMonth(),
                                      1);
        else if (settings.period%7 == 0)
            settings.start = new Date(start.getFullYear(),
                                      start.getMonth(),
                                      start.getDate() - start.getDay());
        else
            settings.start = start;
        if (typeof last !== "undefined" && last >= settings.start) {
            settings.last = last;
            return;
        }
        if (settings.period == "month")
            settings.last = new Date(settings.start.getFullYear(),
                                     settings.start.getMonth() + 1,
                                     0);
        else {
            settings.last = new Date(settings.start.getFullYear(),
                                     settings.start.getMonth(),
                                     settings.start.getDate() + settings.period - 1);
        }
    };

    this._get_visible_range = function() {
        var thestart = new Date(settings.start.getFullYear(),
                                settings.start.getMonth(),
                                settings.start.getDate());
        var thelast = new Date(settings.last.getFullYear(),
                               settings.last.getMonth(),
                               settings.last.getDate());
        // Visible range always starts on a Sunday.
        thestart.setDate(thestart.getDate() - thestart.getDay());
        thelast.setDate(thelast.getDate() + 6 - thelast.getDay());
        return {start: thestart, last: thelast};
    };

    this.href = function(href) {
        if (!href)
            return settings.period + '/' + isodate(settings.start);
        href = href.split('/');
        that.set_period(href[0]);
        if (href.length > 1)
            var start = from_isodate(href[1]);
        that.set_range(start);
        this._init();
    };

    this.refresh = function() {
        var backend = settings.backend;
        var days = that._div.find('.day');
        var range = that._get_visible_range();
        var last = range.last;

        backend.get_range(range.start, last, function() {
            settings.on_refresh(that);

            var current = new Date(range.start.getTime());
            while (current <= last) {
                // Update general day data (footnote etc.)
                var date = isodate(current);
                var day_div = days.filter('[data-date="' + date + '"]');
                var day_data = backend.get_day_data(date);
                var footnote = settings.footnote_renderer(day_data.footnote);
                day_div.find(".footnote").text(footnote);

                // Update the events of that day.
                var events = day_div.find('.events');
                events.empty();
                current.setDate(current.getDate()+1);
                var event_ids = day_data.events;
                if (!event_ids)
                    continue;
                for (var i = 0, l = event_ids.length; i < l; i++) {
                    var event_data = settings.backend.get_event(event_ids[i]);
                    events.append(that._calendar_event(event_data));
                }
            }
        });
    };

    this._init = function() {
        that._div.empty();
        that._div.append('\
            <div id="navbar">\
                <div class="nav-buttons">\
                    <input id="previous" type="button" class="btn hoverable" value="&lt;"/>\
                    <input id="current" type="button" class="btn hoverable" value="&bull;"/>\
                    <input id="next" type="button" class="btn hoverable" value="&gt;"/>\
                    <h2 id="month"></h2>\
                </div>\
                <div class="range-buttons">\
                    <input type="button"\
                        class="btn hoverable"\
                        value="Week"\
                        data-target="7"/>\
                    <input type="button"\
                        class="btn hoverable"\
                        value="Month"\
                        data-target="month"/>\
                    <input type="button"\
                        class="btn hoverable"\
                        value="2 Weeks"\
                        data-target="14"/>\
                </div>\
            </div>\
            <table>\
                <tr>\
                </tr>\
            </table>');
        var table = this._div.find('table');
        $.each(weekdays_short, function(i, val) {
            table.find("tr").append("<th>" + val + "</th>");
        });

        // Expand the range to start Sunday, end Saturday.
        var visible = that._get_visible_range();

        // Update navbar text.
        var month_name = months[settings.start.getMonth()];
        var year = settings.start.getFullYear();
        this._div.find("#month").text(month_name + " " + year);

        // Update the user interface.
        var current_date = new Date(visible.start);
        while(current_date <= visible.last) {
            var week = this._calendar_week(settings.start,
                                           settings.last,
                                           current_date);
            table.append(week);
            var newDate = current_date.setDate(current_date.getDate() + 6);
            current_date = new Date(newDate);
        }

        // Trigger event refresh.
        that.refresh();

        // Connect navbar button events.
        this._div.find("#previous").click(this.previous);
        this._div.find("#current").click(this.to_today);
        this._div.find("#next").click(this.next);
        this._div.find(".range-buttons input").click(function() {
            that.set_period($(this).data('target'));
            that.set_range(settings.start);
            that._init();
        });

        // Unzoom the day when clicking outside of it.
        $('body').mousedown(function(e) {
            if ($(e.target).closest('.SpiffCalendarDialog').length
                    || $(e.target).closest('.ui-datepicker').length)
                return;
            var day = $(e.target).closest('.day');
            if (day.is('.day.active'))
                return;
            table.find('.day.active').each(function(index, day) {
                $(day).animate({
                    top: $(day).data('original_top'),
                    left: $(day).data('original_left'),
                    width: $(day).data('original_width'),
                    height: $(day).data('original_height')
                }, 100, function() {
                    $(day).removeClass('active').css({
                        top: 0,
                        left: 0,
                        width: 'auto',
                        height: 'auto'
                    });
                    $(day).data('placeholder').remove();
                });
            });
        });

        // Fold event when clicking outside of it.
        $('body').click(function(e) {
            if ($(e.target).closest('.ui-datepicker').length)
                return;
            var theevent = $(e.target).closest('.event');
            if (theevent.length == 0 && $(e.target).closest('.day').is('.active'))
                return;
            table.find('.unfolded').not(theevent).each(function() {
                var ev = $(this);
                ev.removeClass('unfolded');
                var ev_data = ev.data('event');
                if (ev_data && !ev_data.id)
                    ev.remove();
            });
        });

        table.find('.day').click(function(e) {
            var day = $(e.target).closest('.day');
            if (!day.is('.day') || day.hasClass('placeholder'))
                return;

            var is_event = ($(e.target).closest('.event').length > 0);
            var new_editor = $(e.target).find('.unfolded').filter(function() {
                return typeof $(this).data('event').id === 'undefined';
            });
            var have_new_editor = (new_editor.length > 0);
            var date = from_isodate(day.attr('data-date'));

            // Create a new event if needed.
            if (!is_event && !have_new_editor)
                var theevent = that.add_event({date: date});
            else
                var theevent = $('');

            if (day.hasClass('active')) {
                theevent.click(); // unfolds the event
                return;
            }

            // Create an exact clone of the day as a placeholder. The reason
            // that we don't use the clone as the editor is that a) there may be
            // events running on the original day, and b) we would have to
            // either use clone(true), causing problems with per-event
            // data not being copied, or re-init/re-draw the day from scratch,
            // causing potential flickering and other headaches.
            var placeholder = day.clone();
            placeholder.css('visibility', 'hidden');
            placeholder.addClass('placeholder');
            placeholder.find('.event').removeClass('unfolded');

            var w = day.width()
            var h = day.height()
            day.data('placeholder', placeholder);
            day.data('original_top', day.offset().top);
            day.data('original_left', day.offset().left);
            day.data('original_width', w);
            day.data('original_height', h);
            day.css({
                top: day.offset().top,
                left: day.offset().left,
                width: w,
                height: h
            });
            day.addClass('active');
            theevent.children(":first").click(); // Unfold the clicked event.

            placeholder.insertAfter(day);

            // Resize the day.
            var top = day.offset().top - h/1.3;
            var left = day.offset().left - w/2;
            h = 2.5*h;
            w = 2*w;

            if (top < 0)
                top = 20;
            if (top + h > $(window).height())
                top -= h/3;
            if (top < 0) {
                top = 20;
                h = $(window).height() - 40;
            }

            if (left < 0)
                left = 20;
            if (left + w > $(window).width())
                left -= w/4;
            if (left < 0) {
                left = 20;
                w = $(window).width() - 40;
            }

            day.animate({
                top: top,
                left: left,
                width: w,
                height: h
            }, 200);
        });

        this._div.children().bind('wheel mousewheel DOMMouseScroll', function (event) {
            if (that._div.find('.active').length)
                return;
            if (event.originalEvent.wheelDelta > 0 || event.originalEvent.detail < 0)
                that.next();
            else
                that.previous();
        });
    };

    this.get_active_date = function() {
        return that._div.find('.day.active').data('date');
    };

    this.previous = function() {
        if (settings.period == 'month')
            var start = new Date(settings.start.getFullYear(),
                                 settings.start.getMonth()-1, 1);
        else
            var start = new Date(settings.start.getFullYear(),
                                 settings.start.getMonth(),
                                 settings.start.getDate() - settings.period);
        that.set_range(start, undefined);
        that._init();
    };

    this.to_today = function() {
        that.set_range(undefined, undefined);
        that._init();
    };

    this.next = function() {
        if (settings.period == 'month')
            var start = new Date(settings.start.getFullYear(),
                                 settings.start.getMonth()+1, 1);
        else
            var start = new Date(settings.start.getFullYear(),
                                 settings.start.getMonth(),
                                 settings.start.getDate() + settings.period);
        that.set_range(start, undefined);
        that._init();
    };

    if (settings.href)
        this.href(settings.href);
    else {
        this.set_range(settings.start, settings.last);
        this._init();
    }
};

// ======================================================================
// Renderer for events, for both inline edit-mode and inline view-mode.
// ======================================================================
var SpiffCalendarEventRenderer = function(options) {
    var that = this;
    var settings = $.extend(true, {
        event_dialog: new SpiffCalendarEventDialog(),
        render_extra_content: function() {},
        serialize_extra_content: function() {},
        deserialize_extra_content: function() {},
        on_render: function(calendar, html, event_data) {},
        on_save_before: function(calendar, html) {
            if (!validate_all(html.find('input')))
                return false;
        },
        on_save: function(calendar, html, event_data) {
            var backend = calendar.settings.backend;
            var func = event_data.id ? backend.save_single : backend.add_event;
            func(backend, event_data, calendar.refresh);
        },
        on_edit_before: function(calendar, html) {},
        on_edit: function(calendar, html, event_data) {
            settings.event_dialog.show(calendar, event_data);
        },
        on_delete_before: function(calendar, event_data) {},
        on_delete: function(calendar, html, event_data) {
            var backend = calendar.settings.backend;
            backend.delete_single(backend, event_data, calendar.refresh);
        }
    }, options);

    this.prerender = function() {
        var html = $('\
            <div>\
                <div class="label">\
                    <span id="label-icon"></span>\
                    <span id="label-prefix"></span>\
                    <span id="label-name"></span>\
                    <span id="label-suffix"></span>\
                </div>\
                <div class="editor">\
                    <div id="general">\
                        <input class="general-name" type="text" placeholder="Event"/>\
                        <input class="general-date" type="text" placeholder="Date"/>\
                    </div>\
                    <div id="extra-content"></div>\
                    <div id="event-buttons">\
                        <a id="button-delete" class="btn waves-effect red"><i class="material-icons">delete</i></a>\
                        <a id="button-edit" class="btn waves-effect"><i class="material-icons">repeat</i></a>\
                        <a id="button-save" class="btn waves-effect"><i class="material-icons">done</i></a>\
                    </div>\
                </div>\
            </div>');

        html.click(function() {
            html = $(this);
            var parent = html.parent();
            if (parent.data('initialized'))
                return;
            parent.data('initialized', true);

            // Initializing the datepicker is extremely slow. By deferring the
            // initialization until the event is clicked, the refresh time for a
            // single page was reduced by 200ms.
            var datepicker = html.find('.general-date');
            if (datepicker.is('.hasDatepicker'))
                return;
            var event_data = html.parent().data('event');
            datepicker.datepicker({
                onSelect: function() {
                    this.blur();
                    $(this).change();
                }
            }).datepicker("setDate", from_isodate(event_data.date));

            // Some other things that also benefit from being deferred until
            // clicked.
            html.find('.general-name').val(event_data.name);

            // Connect event handlers for input validation.
            var save_btn = html.find('#button-save');
            var inputs = html.find('#general').children();
            inputs.keydown(function(e) {
                $(this).removeClass('error');
                if (e.keyCode === 13)
                    save_btn.click();
            });
            inputs.bind('keyup change select', function(e) {
                var nothidden = inputs.filter(":not([style$='display: none;'])");
                var invalid = get_invalid_fields(nothidden);
                save_btn.prop("disabled", invalid.length != 0);
            });

            // Connect button event handlers.
            save_btn.click(function(event) {
                var editor = $(this).closest('.editor').parent();
                var calendar = editor.closest('.SpiffCalendar').data('SpiffCalendar');
                if (settings.on_save_before(calendar, editor) == false)
                    return;
                that._serialize(editor, event_data, true);
                if (settings.on_save(calendar, editor, event_data) != false)
                    editor.removeClass('unfolded');
                event.stopPropagation(); // prevent from re-opening
            });
            html.find('#button-edit').click(function(event) {
                var editor = $(this).closest('.editor').parent();
                var calendar = editor.closest('.SpiffCalendar').data('SpiffCalendar');
                if (settings.on_edit_before(calendar, editor) == false)
                    return;
                that._serialize(editor, event_data, false);
                if (settings.on_edit(calendar, editor, event_data) != false)
                    editor.removeClass('unfolded');
            });
            html.find('#button-delete').click(function(event) {
                var editor = $(this).closest('.editor').parent();
                var calendar = editor.closest('.SpiffCalendar').data('SpiffCalendar');
                that._serialize(editor, event_data, false);
                if (settings.on_delete(calendar, editor, event_data) != false)
                    editor.removeClass('unfolded');
                event.stopPropagation(); // prevent from re-opening
            });

            // Trigger validation.
            inputs.keyup();

            // Extra content may be provided by the user.
            // If the user provided settings.render_extra_content, he may
            // also want to populate it with data.
            var extra = html.find('#extra-content');
            settings.render_extra_content(extra, event_data);
            settings.deserialize_extra_content(extra, event_data);
        });

        // Define input validators for pre-defined fields.
        html.find('input').data('validator', validator_required);
        return html;
    };
    var prerendered = this.prerender();

    this.render = function(calendar_div, html, event_data) {
        if (event_data.time)
            html.addClass('timed');
        if (event_data.freq_type != null && event_data.freq_type !== 'ONE_TIME')
            html.addClass('recurring');
        if (event_data.is_exception)
            html.addClass('exception');

        html.append(prerendered.clone(true));

        // These fields are only shown on new events.
        if (!event_data.id) {
            html.find('.general-date').hide();
            html.find('#button-delete').hide();
        }

        // Add data to the UI.
        if (event_data.time)
            html.find('#label-prefix').text(event_data.time);
        else
            html.find('#label-prefix').hide();
        html.find('#label-name').text(event_data.name);
        settings.on_render(html, event_data);

        html.click(function() {
            if ($(this).is('.unfolded'))
                return;
            $(this).addClass('unfolded');
            $(this).find('input:first').focus();
        });

        html.draggable({
            appendTo: calendar_div,
            helper: function(e, ui) {
                var original = $(e.target).closest(".ui-draggable");
                return $(this).clone().css({width: original.width()});
            },
            revert: "invalid",
            cursor: "move",
            revertDuration: 100,
            start: function (e, ui) {
                $(this).hide();
            },
            stop: function (event, ui) {
                $(this).show();
            }
        });
    };

    this._serialize = function(html, event_data, include_date) {
        var date = html.find('.general-date').datepicker('getDate');
        if (!event_data)
            event_data = {};
        if (include_date == true)
            event_data.date = date;
        event_data.name = html.find('.general-name').val();

        // If the user provided settings.render_extra_content, he may
        // also want to serialize it.
        var extra = html.find('#extra-content');
        settings.serialize_extra_content(extra, event_data);
    };
};

// ======================================================================
// Dialog for editing event details.
// ======================================================================
var SpiffCalendarEventDialog = function(options) {
    this._div = $('<div class="SpiffCalendarDialog modal"></div>');
    var that = this;
    var settings = $.extend(true, {
        region: 'en',
        event_data: {date: new Date()},
        render_extra_content: function(div, event_data) {},
        serialize_extra_content: function() {},
        deserialize_extra_content: function() {},
        on_save: function(calendar, event_data) {
            //console.log('EventDialog.on_save', event_data);
            var backend = calendar.settings.backend;
            var func = event_data.id ? backend.save_event : backend.add_event;
            func(backend, event_data, calendar.refresh);
        },
        on_delete: function(calendar, event_data) {
            //console.log('EventDialog.on_delete:', event_data);
            var backend = calendar.settings.backend;
            backend.delete_event(backend, event_data, calendar.refresh);
        }
    }, options);

    this.regional = $.datepicker.regional[settings.region];
    weekdays = this.regional.dayNames;

    this._recurring_range = function() {
        var html = $('\
            <div class="recurring-range">\
              <select>\
                  <option value="forever">forever</option>\
                  <option value="until">until</option>\
                  <option value="times">until counting</option>\
              </select>\
              <span id="recurring-range-until">\
                  <input type="text" class="datepicker"/>\
              </span>\
              <span id="recurring-range-times">\
                  <input id="recurring-range-times-field" type="number" min="1" value="1"/>\
                  <label>times.</label>\
              </span>\
            </div>');
        html.find('input.datepicker').datepicker();
        html.find('input.datepicker').data('validator', validator_required);
        html.find('#recurring-range-times-field').data('validator', validator_required);
        html.find('select').change(function() {
            html.find('span').hide();
            html.find('#recurring-range-' + $(this).val()).show();
        });
        html.find('select').change();
        return html;
    };

    this._recurring_never = function() {
        var html = $('\
            <div class="recurring-never" style="display: none">\
            </div>');
        return html;
    };

    this._recurring_day = function() {
        var html = $('\
            <div class="recurring-day" style="display: none">\
              Repeat every\
              <input class="interval" type="number" min="1" value="1"/>\
              day(s),\
            </div>');
        html.find('input.interval').data('validator', validator_required);
        html.append(that._recurring_range());
        return html;
    };

    this._recurring_week = function() {
        var html = $('\
            <div class="recurring-week" style="display: none">\
              Repeat every\
              <input class="interval" type="number" min="1" value="1"/>\
              week(s) on\
              <div id="weekdays"></div>,\
            </div>');
        html.find('input.interval').data('validator', validator_required);

        // Day selector.
        $.each(weekdays, function(i, val) {
            var day_html = $('<input type="checkbox" name="day"/><label></label>');
            var input_id = uuid();
            day_html.filter('input').data('value', Math.pow(2, (i == 0) ? 6 : (i-1)));
            day_html.filter('input').prop('id', input_id);
            day_html.filter('label').prop('for', input_id);
            day_html.filter('label').append(val);
            html.find('#weekdays').append(day_html);
        });
        html.find('input').data('validator-target', html.find('#weekdays'));
        html.find('input').data('validator', function() {
            return html.find('input:checked').length > 0;
        });

        html.append(that._recurring_range());
        return html;
    };

    this._recurring_month = function() {
        var html = $('\
            <div class="recurring-month" style="display: none">\
              Repeat every\
              <input class="interval" type="number" min="1" value="1"/>\
              month(s), on\
              <span id="recurring-month-byday">\
              the\
                  <select id="recurring-month-count">\
                        <option value="1">first</option>\
                        <option value="2">second</option>\
                        <option value="4">third</option>\
                        <option value="8">fourth</option>\
                        <option value="-1">last</option>\
                        <option value="-2">second-last</option>\
                        <option value="-4">third-last</option>\
                        <option value="-8">fourth-last</option>\
                  </select>\
              </span>\
              <select id="recurring-month-weekday">\
                  <option value="0">day</option>\
              </select>\
              <input id="recurring-month-dom" type="number" min="1" max="31"/>,\
            </div>');
        html.find('#recurring-month-dom').hide();
        html.find('input.interval').data('validator', validator_required);

        // Day selector.
        $.each(weekdays, function(i, val) {
            var day_html = $('<option/>');
            day_html.val(Math.pow(2, (i == 0) ? 6 : (i-1)));
            day_html.append(val);
            html.find('#recurring-month-weekday').append(day_html);
        });

        html.find('#recurring-month-weekday').change(function() {
            if ($(this).val() == 0) {
                html.find('#recurring-month-byday').hide();
                html.find('#recurring-month-dom').show();
            }
            else {
                html.find('#recurring-month-dom').hide();
                html.find('#recurring-month-byday').show();
            }
        });

        html.append(that._recurring_range());
        return html;
    };

    this._recurring_year = function() {
        var html = $('\
             <div class="recurring-year" style="display: none">\
               Repeat every\
               <input class="interval" type="number" min="1" value="1"/>\
               year(s),\
            </div>');
        html.find('input.interval').data('validator', validator_required);
        html.append(that._recurring_range());
        return html;
    };

    this._get_section_from_freq_type = function(freq_type) {
        if (freq_type === 'ONE_TIME')
            return that._div.find('.recurring-never');
        else if (freq_type === 'DAILY')
            return that._div.find('.recurring-day');
        else if (freq_type === 'WEEKLY')
            return that._div.find('.recurring-week');
        else if (freq_type === 'MONTHLY')
            return that._div.find('.recurring-month');
        else if (freq_type === 'ANNUALLY')
            return that._div.find('.recurring-year');
        console.error('invalid freq_type', freq_type);
    };

    this._period_changed = function() {
        var input = $(this);
        that._div.find('#recurring-period button').removeClass('active');
        input.addClass('active');
        var freq_type = input.val();
        that._div.find('#recurring-detail>div').hide();
        var section = that._get_section_from_freq_type(freq_type);
        section.show();
    };

    this._init = function() {
        that._div.append('\
            <div class="modal-content">\
                <h5>Repeating Events</h5>\
                <div class="general">\
                    <input id="general-name" type="text" placeholder="Name"/>\
                    <input id="general-date" type="text" placeholder="Date"/>\
                </div>\
                <div id="extra-content"></div>\
                <div id="recurring-period" class="radio-bar">\
                </div>\
                <div id="recurring-detail">\
                </div>\
                <div id="buttons">\
                    <button id="button-delete">Delete</button>\
                    <button id="button-save">Save</button>\
                </div>\
            </div>');
        that._div.find('#error').hide();
        that._div.find('#general-name').data('validator', validator_required);
        that._div.find('#general-date').datepicker();
        that._div.find('#general-date').data('validator', validator_required);

        // Period selector.
        $.each(periods, function(index, item) {
            var button = $('<button name="period"></button>');
            button.val(item);
            button.append(period_names[index]);
            button.click(that._period_changed);
            that._div.find('#recurring-period').append(button);
        });

        /*/ Month selector.
        $.each(months, function(i, val) {
            var month_html = $('<label><input type="checkbox" name="month"/></label>');
            month_html.val(i+1);
            month_html.append(val);
        });
    */

        var detail = that._div.find('#recurring-detail');
        detail.append(that._recurring_never());
        detail.append(that._recurring_day());
        detail.append(that._recurring_week());
        detail.append(that._recurring_month());
        detail.append(that._recurring_year());
        detail.find("button:first").click();

        // Extra content may be provided by the user.
        settings.render_extra_content(that._div.find('#extra-content'),
                                      settings.event_data);

        // Validate fields on input.
        var save_btn = that._div.find('#button-save');
        that._div.find('input').keydown(function(e) {
            $(this).removeClass('error');
            if (e.keyCode === 13)
                save_btn.click();
        });
        that._div.find('input').change(function(e) {
            if ($(this).data('validator-target'))
                $(this).data('validator-target').removeClass('error');
            else
                $(this).removeClass('error');
        });
        that._div.find('input,select,button').bind('keyup change select click', function(e) {
            var nothidden = that._div.find("input:visible");
            var invalid = get_invalid_fields(nothidden);
            save_btn.prop("disabled", invalid.length != 0);
        });

        that._div.find('#button-save').click(function(e) {
            var nothidden = that._div.find("input:visible");
            var invalid = get_invalid_field_targets(nothidden);
            if (invalid.length != 0) {
                invalid.addClass('error');
                e.stopPropagation();
                return;
            }
            that._div.closeModal();
            that._serialize(settings.event_data);
            var calendar = $(this).closest('.SpiffCalendar').data('SpiffCalendar');
            return settings.on_save(calendar, settings.event_data);
        });
        that._div.find('#button-delete').click(function(e) {
            that._div.closeModal();
            var calendar = $(this).closest('.SpiffCalendar').data('SpiffCalendar');
            return settings.on_delete(calendar, settings.event_data);
        });
    };

    this._serialize = function(event_data) {
        // Serialize general data first.
        event_data.name = that._div.find('#general-name').val();
        event_data.date = that._div.find('#general-date').datepicker('getDate');

        // Serialize recurrence data.
        var selected = that._div.find('#recurring-period button.active');
        var freq_type = selected.val();
        event_data.freq_type = freq_type;

        // Much of the recurrence data depends on the currently selected
        // freq_type.
        var section = that._get_section_from_freq_type(freq_type);
        event_data.freq_interval = section.find('.interval').val();

        // Serialize freq_target.
        if (freq_type === 'WEEKLY') {
            var flags = 0;
            section.find('#weekdays input:checked').each(function() {
                flags |= $(this).data('value');
            });
            event_data.freq_target = flags;
        }
        else if (freq_type === 'MONTHLY')
            event_data.freq_target = section.find('#recurring-month-weekday').val();
        else if (freq_type === 'ANNUALLY')
            event_data.freq_target = 0; //section.find('#recurring-year-doy').val(); <- see docs in _update()
        else
            event_data.freq_target = undefined;

        // Serialize freq_count.
        if (freq_type === 'MONTHLY' && event_data.freq_target == 0)
            event_data.freq_count = section.find('#recurring-month-dom').val();
        else if (freq_type === 'MONTHLY')
            event_data.freq_count = section.find('#recurring-month-count').val();
        else
            event_data.freq_count = undefined;

        // Serialize until_count and until_date.
        var duration = section.find('.recurring-range select').val();
        var until_date = section.find('#recurring-range-until input').datepicker('getDate');
        var until_count = section.find('#recurring-range-times input').val();
        event_data.until_date = undefined;
        event_data.until_count = undefined;
        if (duration === 'until')
            event_data.until_date = until_date;
        else if (duration === 'times')
            event_data.until_count = until_count;

        // Lastly, if the user provided settings.render_extra_content, he may
        // also want to serialize it.
        var extra = that._div.find('#extra-content');
        settings.serialize_extra_content(extra, event_data);
    };

    this._update = function() {
        if (settings.event_data.name)
            that._div.find('#button-delete').show();
        else
            that._div.find('#button-delete').hide();

        // Update general event data.
        this._div.find('#general-name').val(settings.event_data.name);
        var date = from_isodate(settings.event_data.date);
        if (!date)
            date = new Date();
        this._div.find("#general-date").datepicker('setDate', date);

        var freq_type = settings.event_data.freq_type;
        var period_id = periods.indexOf(freq_type);
        if (period_id == -1)
            period_id = 0;
        this._div.find("button")[period_id].click();

        // Update the weekday for weekly events.
        var freq_target = settings.event_data.freq_target;
        if (freq_target == null) {
            var day_num = date.getDay();
            freq_target = Math.pow(2, (day_num == 0) ? 6 : (day_num-1));
        }
        var section = that._get_section_from_freq_type('WEEKLY');
        section.find('#weekdays input').each(function() {
            $(this).prop('checked', (freq_target&$(this).data('value')) != 0);
        });

        // Update the day of month for monthly events.
        var freq_target = settings.event_data.freq_target;
        if (freq_target == null)
            freq_target = 0;
        section = that._get_section_from_freq_type('MONTHLY');
        section.find('#recurring-month-weekday').val(freq_target);
        section.find('#recurring-month-weekday').change();
        section.find('#recurring-month-dom').val(date.getDate());
        var num_days = new Date(date.getFullYear(),
                                date.getMonth() + 1,
                                0).getDate();
        section.find('#recurring-month-dom').prop('max', num_days);

        if (freq_type) {
            var section = that._get_section_from_freq_type(freq_type);

            // Update interval (=nth day/week/month/year)
            section.find('.interval').val(settings.event_data.freq_interval);

            // MONTLY is the only type where freq_count matters. It is a
            // bitmask specifiying the nth freq_target of the month. E.g.
            // 1=first target of the month, 2=second, 4=third
            // -1=last target of the month, -2=second-last, ...
            // 0=every occurence.
            if (freq_type === 'MONTHLY')
                section.find('#recurring-month-count').val(settings.event_data.freq_count);

            //We have no UI yet for specifying annual events with a fixed target
            //day. Hence for annual events, freq_target is always 0, meaning "same
            //calendar day as the initial event".
            //else if (freq_type === 'ANNUALLY')
            //    section.find('#recurring-year-doy').val(settings.event_data.freq_target);

            // Deserialize until_count and until_date.
            var input = section.find('#recurring-range-until input');
            input.datepicker('setDate', from_isodate(settings.event_data.until_date));
            section.find('#recurring-range-times input').val(settings.event_data.until_count);
            var select = section.find('.recurring-range select');
            if (settings.event_data.until_date)
                select.find('option[value="until"]').prop('selected', true);
            else if (settings.event_data.until_count)
                select.find('option[value="times"]').prop('selected', true);
            else
                select.find('option[value="forever"]').prop('selected', true);
            select.change();
        }

        // Lastly, if the user provided settings.render_extra_content, he may
        // also want to populate it with data.
        var extra = that._div.find('#extra-content');
        settings.deserialize_extra_content(extra, settings.event_data);
    };

    this.show = function(calendar, event_data) {
        if (event_data)
            settings.event_data = $.extend(true, {}, event_data);
        this._update();
        if (!that._div.closest('.SpiffCalendar').length)
            calendar._div.append(that._div);
        that._div.openModal();

        // Trigger validation.
        that._div.find('input').change();
    };

    this.hide = function() {
        this._div.hide();
    };

    this._init();
    this._update();
};
