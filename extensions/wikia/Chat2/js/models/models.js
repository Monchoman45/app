var STATUS_STATE_PRESENT = 'here'; // strings instead of ints just for easier debugging. always use the vars, don't hardcode strings w/these states elsewhere.
var STATUS_STATE_AWAY = 'away';

(function () {
	var server = false, models;
	if (typeof exports !== 'undefined') {
		_ = require('underscore')._;
		Backbone = require('backbone');

		models = exports;
		server = true;
	} else {
		models = this.models = {};
	}

	//
	//models
	//

	models.AuthInfo = Backbone.Model.extend({
		defaults: {
			'name': '', // username, NOT trusted (comes from client) but helpful w/debugging and double check.
			'cookie': '', // the full string of cookies from the user
			'roomId': '' // the room the user is trying to get into
		}
	});

	/** Commands **/
	models.Command = Backbone.Model.extend({
		defaults: {
			msgType: 'command', // used by the server to determine how to handle one of these objects.
			command: '',
			prevented: false
		},
		//This is called by listeners on the client if they want to tell the native system not to send the command.
		prevent: function() {
			this.set({prevented: true});
		}
	});

	models.OpenPrivateRoom = models.Command.extend({
		initialize: function(options){
			if(!options) return;
			this.set({
				command: 'openprivate',
				roomId: options.roomId,
				users: options.users
			});
		}
	});

	models.InitqueryCommand = models.Command.extend({
		initialize: function(){
			this.set({
				command: 'initquery'
			});
		}
	});

	models.LogoutCommand = models.Command.extend({
		initialize: function(){
			this.set({
				command: 'logout'
			});
		}
	});

	models.KickCommand = models.Command.extend({
		initialize: function(options){
			if(!options) return;
			this.set({
				command: 'kick',
				userToKick: options.userToKick
			});
		}
	});

	models.BanCommand = models.Command.extend({
		initialize: function(options){
			if(!options) return;
			this.set({
				command: 'ban',
				userToBan: options.userToBan,
				reason: options.reason,
				time: options.time
			});
		}
	});

	models.UnbanCommand = models.Command.extend({
		initialize: function(options) {
			if(!options) {return;}
			this.set({
				command: 'unban',
				userToUnban: options.userToUnban,
				reason: options.reason
			});
		}
	});

	models.GiveChatModCommand = models.Command.extend({
		initialize: function(options){
			if(!options) return;
			this.set({
				command: 'givechatmod',
				userToPromote: options.userToPromote
			});
		}
	});

	models.SetStatusCommand = models.Command.extend({
		initialize: function(options){
			if(!options) return;
			this.set({
				command: 'setstatus',
				statusState: options.statusState,
				statusMessage: options.statusMessage
			});
		}
	});

	models.LogoutEvent = Backbone.Model.extend({
		initialize: function(options){
			if(!options) return;
			this.set({
				name: options.name
			});
		}
	});

	models.KickEvent = Backbone.Model.extend({
		initialize: function(info) {
			if(!info) {return;}
			this.set({
				performer: info.performer,
				target: info.target
			});
		}
	});

	models.BanEvent = Backbone.Model.extend({
		initialize: function(info) {
			if(!info) {return;}
			this.set({
				performer: info.performer,
				target: info.target,
				time: info.time,
				reason: info.reason
			});
		}
	});

	models.UnbanEvent = Backbone.Model.extend({
		initialize: function(info) {
			if(!info) {return;}
			this.set({
				performer: info.performer,
				target: info.target,
				reason: info.reason
			});
		}
	});

	models.ModEvent = Backbone.Model.extend({
		initialize: function(info) {
			if(!info) {return;}
			this.set({
				performer: info.performer,
				target: info.target
			});
		}
	});

	models.DisableReconnectEvent = Backbone.Model.extend({
		initialize: function(info) {
			if(!info) {return;}
			this.set({
				wfMsg: info.wfMsg,
				msgParams: info.msgParams ? info.msgParams : []
			});
		}
	});

	models.ErrorEvent = Backbone.Model.extend({
		initialize: function(info) {
			if(!info) {return;}
			this.set({
				command: info.command,
				wfMsg: info.wfMsg,
				msgParams: info.msgParams ? info.msgParams : []
			});
		}
	});

	/** ChatEntries (messages, alerts) **/
	models.ChatEntry = Backbone.Model.extend({
		defaults: {
			'msgType': 'chat', // used by the server to determine how to handle one of these objects.
			'roomId' : 0,
			'name': '',
			'text': '',
			'avatarSrc': '',
			'timeStamp': '',
			'continued': false,
			'temp': false //use for long time connection with private
		}
	});
	/**
	 * Inline alerts are a special type of ChatEntry which aren't from a user and should be displayed differently (like system messages basically).
	 *
	 * If 'wfMsg' is set, then the code in wfMsg will be passed to the $.msg() i18n function and
	 * 'msgParams' will be used as the parameters.  In this case, 'text' should be left blank on the server-side because it will
	 * be used on the client-side as a cache of the output of the $.msg(wfMsg, msgParams) call. If 'text' is already filled in, then the i18n processing
	 * will be assumed to have already been done.
	 */
	models.InlineAlert = models.ChatEntry.extend({
		initialize: function(options){
			if(!options) return;
			this.set({
				isInlineAlert: true, // so that the view can detect that this should be displayed specially
				text: options.text,
				wfMsg: options.wfMsg,
				msgParams: options.msgParams
			});
		}
	});

	/**
	 * CTCP (client to client protocol) comes from IRC, where it is used to get arbitrary data from other clients.
	 * A CTCP message is sent from one client to the server, which simply forwards it to the target client,
	 * which can evaluate the message however it chooses. Most IRC clients implement at a minimum VERSION, for which
	 * the reply should be the name of the client and the version number, but aren't required to. A CTCP message only
	 * means something if both clients think it means something, hopefully the same thing.
	 *
	 * For Wikia chat, CTCP is mostly for the benefit of bots - PMs are a heavyweight way of talking to other bots,
	 * whereas CTCP allows communication without making a new socket; it also makes it easier to identify other bots.
	 *
	 * 'target' is the user who should receive the message.
	 * 'sender' is the sending user. The server will set this with the actual sender to prevent spoofing.
	 * 'type' is used by the receiving client to identify what the point of the message is (such as 'version').
	 * 'data' is additional information for the client.
	 */
	models.CTCPMessage = Backbone.Model.extend({
		initialize: function(options) {
			if(!options) {return;}
			this.set({
				msgType: 'ctcp',
				target: options.target,
				sender: options.sender,
				type: options.type,
				data: options.data
			});
		}
	});


	var modelInit = function() {
		this.chats = new models.ChatCollection();
		this.users = new models.UserCollection();
		this.privateUsers = new models.UserCollection();
		this.blockedUsers = new models.UserCollection();
		this.blockedByUsers = new models.UserCollection();

		this.chats.bind('add', function(current) {
			var last = this.at(this.length - 2);

			if(typeof(last) == 'object' ) {
				if(last.get('name') == current.get('name') && current.get('msgType') == 'chat' && current.get('msgType') == 'chat') {
					current.set({'continued': true});
				}

				if(last.get('temp') != current.get('temp')) {
					current.set({'continued': false});
				}
			} else {
				current.set({'continued': false});
			}

			this.trigger('afteradd', current);
		});

		this.chats.bind('remove', function(current) {
			current.set({'continued': false });
		});
	}

	models.NodeChatModel = Backbone.Model.extend({
		defaults: {
			"clientId": 0
		},

		initialize: function() {
			modelInit.apply(this,arguments);
		}
	});

	models.NodeChatModelCS = models.NodeChatModel.extend({
		initialize: function() {
			modelInit.apply(this,arguments);
			this.room = new models.ChatRoom();
		}
	});

	models.User = Backbone.Model.extend({
		defaults: {
			'name': '',
			'since': '',
			'statusMessage': '',
			'statusState': STATUS_STATE_PRESENT,
			'isModerator': false,
			'isStaff': false,
			'isCanGiveChatMod': false,
			'avatarSrc': "http://placekitten.com/50/50",
			'editCount': '?',
			'isPrivate': false,
			'active': false,
			'privateRoomId': false
		},

		initialize: function(options){

		},

		isAway: function(){
			return (this.get('statusState') == STATUS_STATE_AWAY);
		}
	});

	models.PrivateUser = models.User.extend({
		initialize: function(options){
			if(!options) return;
			this.set({
				privateRoomId: options.privateRoomId,
				isPrivate: true
			});
		}
	});

	models.ChatRoom = Backbone.Model.extend({
		defaults: {
			'roomId': 0,
			'unreadMessage': 0,
			'blockedMessageInput': false,
			'isActive': false,
			'privateUser': false
		}
	});

	//
	//Collections
	//

	models.ChatCollection = Backbone.Collection.extend({
		model: models.ChatEntry
	});

	var findByName = function(name) {
		var userObject = this.find(function(user){
			return (user.get('name') == name);
		});
		return userObject;
	}

	models.UserCollection = Backbone.Collection.extend({
		model: models.User,
		initialize: function() {
			this.findByName = findByName;
		}
	});

	models.PrivateUserCollection = Backbone.Collection.extend({
		model: models.PrivateUser,
		initialize: function() {
			this.findByName = findByName;
		}
	});

	//
	//Model exporting/importing
	//

	Backbone.Model.prototype.xport = function (opt) {
		var result = {},
		settings = _({recurse: true}).extend(opt || {});

		function process(targetObj, source) {
			targetObj.id = source.id || null;
			targetObj.cid = source.cid || null;
			targetObj.attrs = source.toJSON();
			_.each(source, function (value, key) {
				// since models store a reference to their collection
				// we need to make sure we don't create a circular refrence
				if (settings.recurse) {
					if (key !== 'collection' && source[key] instanceof Backbone.Collection) {
						targetObj.collections = targetObj.collections || {};
						targetObj.collections[key] = {};
						targetObj.collections[key].models = [];
						targetObj.collections[key].id = source[key].id || null;
						_.each(source[key].models, function (value, index) {
							process(targetObj.collections[key].models[index] = {}, value);
						});
					} else if (source[key] instanceof Backbone.Model) {
						targetObj.models = targetObj.models || {};
						process(targetObj.models[key] = {}, value);
					}
				}
			});
		}

		process(result, this);

		return JSON.stringify(result);
	};


	Backbone.Model.prototype.mport = function (data, silent) {
		//console.log("DATA FROM mport:\n" + data);

		function process(targetObj, data) {

			targetObj.id = data.id || null;
			targetObj.set(data.attrs, {silent: silent});
			// loop through each collection
			if (data.collections) {
				_.each(data.collections, function (collection, name) {
					targetObj[name].id = collection.id;
					_.each(collection.models, function (modelData, index) {
						var newObj = targetObj[name]._add(modelData.attrs, {silent: silent});
						process(newObj, modelData);
					});
				});
			}

			if (data.models) {
				_.each(data.models, function (modelData, name) {
					process(targetObj[name], modelData);
				});
			}
		}

		try{
			process(this, JSON.parse(data) );
		} catch (e){
			if (typeof console != 'undefined') {
				console.error("Unable to parse message in mport. Data attempted to parse was: ");
				console.error(data);
				console.error("Parsing error was: ");
				console.error(e);
			} else {
				throw e;
			}
		}

		return this;
	};

})()
