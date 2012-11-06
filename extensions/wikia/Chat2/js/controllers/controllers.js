//
//Controllers
//

var NodeChatSocketWrapper = $.createClass(Observable,{
	proxy: $.proxy,
	connected: false,
	firstConnected: false,
	autoReconnect: true,
	isInitialized: false,
	comingBackFromAway: false,
	roomId: false,
	socket: false,
	constructor: function( roomId ) {
		NodeChatSocketWrapper.superclass.constructor.apply(this,arguments);
		this.sessionData = null;
		this.roomId = roomId;
	},

	send: function($msg) {
		$().log( $msg, 'message');
		if(this.socket) {
			this.socket.emit('message', $msg);
		}
	},

	connect: function() {
		var url = 'http://' + WIKIA_NODE_HOST + ':' + WIKIA_NODE_PORT;
		$().log(url, 'Chat server');
		
		if( this.socket ) {
			if(this.socket.socket.connected) {
				return true;
			} else {
				this.socket.removeAllListeners('message');
				this.socket.removeAllListeners('connect');
				this.socket.removeAllListeners('connect_failed');
			}
		}
		this.authRequestWithMW( function(data){
			var socket = io.connect(url, {
				'force new connection' : true,
				'try multiple transports': true,
				'connect timeout': false,
				'query':data,
				'max reconnection attempts': 8,
				'reconnect':true
			});

			socket.on('message', this.proxy( this.onMsgReceived, this ) );
			socket.on('connect', this.proxy( function(){this.onConnect(socket, [ 'xhr-polling' ]); }, this ) );
			
			var connectionFail = this.proxy( function(delay, count) {
				if(count == 8) {
					if(socket) { 
						socket.disconnect();
					}
					this.fire( "reConnectFail", {} );
				}
			}, this);

			socket.on( 'reconnecting', connectionFail  );
		} );
	},

	onConnect: function(socket, transport) {
		this.socket = socket;

		if(!this.firstConnected) {
			var InitqueryCommand = new models.InitqueryCommand();
			setTimeout($.proxy(function() {
				this.socket.send(InitqueryCommand.xport());
			}, this ), 500);
		}

		$().log("connected.");
	},

	authRequestWithMW: function(callback) {
		//hacky fix of fb#19714
		//it seems socket.io decodes it -- that's why I double encoded it
		//but maybe we should implement here authorization via user id instead of username?
		var encodedWgUserName = encodeURIComponent(encodeURIComponent(wgUserName));
		this.checkSession = function(data) {
			$().log(encodedWgUserName);

		};

		this.proxy(callback, this)('name=' + encodedWgUserName + '&key=' + wgChatKey + '&roomId=' + this.roomId );
	},


    forceReconnect: function() {
		NodeChatSocketWrapper.sessionData = null;
		this.socket.disconnectSync();
		this.socket = null;
		this.connect();
    },

	onMsgReceived: function(message) {
		switch(message.event) {
			case 'disableReconnect':
				this.autoReconnect = false;
				break;
			case 'forceReconnect':
				this.forceReconnect();
				break;
			case 'initial':
				this.firstConnected = true; //we are 100% sure about conenction
				break;
		}
		if(this.firstConnected) {
			this.fire( message.event, message );
		}
	}
});

var NodeRoomController = $.createClass(Observable,{
	active: false,
	unreadMessage: 0,
	roomId: null,
	mainController: null,
	partTimeOuts: {},
	afterInitQueue: [],
	banned: {},
	userMain: null,
	maxCharacterLimit: 1000,
	sanitizeHtml: function(str) {
		return str.replace(/</g, "&lt;").replace(/>/g, "&gt;");	// Prevent simple HTML/JS vulnerabilities
	},
	constructor: function(roomId) {

		NodeRoomController.superclass.constructor.apply(this,arguments);

		this.afterInitQueue = [];
		$().log(this.afterInitQueue);
		this.socket = new NodeChatSocketWrapper( roomId );
		this.roomId = roomId;

		this.model = new models.NodeChatModelCS();

		this.model.room.set({
			'roomId': roomId,
			'unreadMessage': 0,
			'isActive': this.active
		});

		// This is called any time a new message arrives in the room.
		this.model.chats.bind('add', $.proxy(function(current) {
			if(current.get('isInlineAlert') !== true && current.get('msgType') == 'chat' && current.get('name') != wgUserName) {
				this.unreadMessage ++;
			}

			if(this.active == true) {
				this.unreadMessage = 0
			}

			var data = {
				'unreadMessage': this.unreadMessage,
				'isActive': this.active
			};

			this.model.room.set(data);
		}, this));

		this.socket.bind('join',  $.proxy(this.onJoin, this));
		this.socket.bind('initial',  $.proxy(this.onInitial, this));
		this.socket.bind('chat:add',  $.proxy(this.onChatAdd, this));
		this.socket.bind('ctcp', $.proxy(this.onCTCP, this));

		this.socket.bind('reConnectFail',  $.proxy(this.onReConnectFail, this));
		this.socket.bind('part',  $.proxy(this.onPart, this));
		this.socket.bind('kick',  $.proxy(this.onKick, this));
		this.socket.bind('ban',  $.proxy(this.onBan, this));
		this.socket.bind('unban',  $.proxy(this.onUnban, this));
		this.socket.bind('mod',  $.proxy(this.onMod, this));
		this.socket.bind('error', $.proxy(this.onError, this));
		this.socket.bind('disableReconnect', $.proxy(this.onDisableReconnect, this));

		this.socket.bind('logout',  $.proxy(this.onLogout, this));

		this.viewDiscussion = new NodeChatDiscussion({model: this.model, el: $('body'), roomId: roomId});
		this.viewDiscussion.bind('clickAnchor', $.proxy(this.clickAnchor, this) );
		this.viewDiscussion.bind('inputKeypress', $.proxy(this.onKeypress, this) );
		this.viewDiscussion.bind('inputKeyup', $.proxy(this.updateCharacterCount, this) );
		this.viewDiscussion.bind('inputKeydown', $.proxy(this.updateCharacterCount, this) );

		//TODO: move to view ??
		$(window).focus($.proxy(function(e) {// set focus on the text input
			if($(e.target).attr('name') != 'message') {
				this.viewDiscussion.getTextInput().focus();
			}
		},this));

		this.viewDiscussion.getTextInput().focus();
	},

	isMain: function() {
		return this.mainController == null;
	},

	onDisableReconnect: function(message) {
		var disableReconnectEvent = new models.DisableReconnectEvent();
		disableReconnectEvent.mport(message.data);
		if(disableReconnectEvent.wfMsg) {
			var chatEntry = new models.InlineAlert({wfMsg: disbleReconnectEvent.wfMsg, msgParams: disableReconnectEvent.msgParams});
			this.model.chats.add(chatEntry);
		}
	},

	onError: function(message) {
		var errorEvent = new models.ErrorEvent();
		errorEvent.mport(message.data);
		if(errorEvent.wfMsg) {
			var chatEntry = new models.InlineAlert({wfMsg: errorEvent.wfMsg, msgParams: errorEvent.msgParams});
			this.model.chats.add(chatEntry);
		}
	},

	onReConnectFail: function(message) {
		var chatEntry = new models.InlineAlert({text: $.msg( 'chat-user-permanently-disconnected' ) });
		this.model.chats.add(chatEntry);
	},

	onInitial: function(message) {
		if(!this.isInitialized){

			_.each(this.model.chats.models, $.proxy(function(data) {
				this.model.chats.remove(data);
			},this));

			this.model.chats.trigger('clear');
			// On first connection, just update the entire model.
			this.model.mport(message.data);

			this.isInitialized = true;
			$().log(this.isInitialized, "isInitialized");
			if(this.isMain()) {
				var newChatEntry = new models.InlineAlert({text: $.msg('chat-welcome-message', wgSiteName ) });
				this.model.chats.add(newChatEntry);
			}

			this.userMain = this.model.users.findByName(wgUserName);
		} else {
			// If this is a reconnect... go through the model that was given and selectively, only add ChatEntries that were not already in the collection of chats.
			var jsonObj = JSON.parse(message.data);
			var chatEntries = this.model.chats;
			_.each(jsonObj.collections.chats.models, function(item, index){
				var match = chatEntries.get(item.id);
				if(typeof match == "undefined"){
					$().log("Found a ChatEntry that must have occurred during reconnection. Adding it to the model...");
					var additionalEntry = new models.ChatEntry();
					additionalEntry.mport( JSON.stringify(item) );
					chatEntries.add(additionalEntry);
				}
			});

			// TODO: update the entire userlist (if the server went down or something, you're not going to get "part" messages for the users who are gone).
			// See BugzId 6107 for more info & partially completed code.
		}

		for(var i in this.afterInitQueue) {
			this.socket.send(this.afterInitQueue[i]);
		}

		this.afterInitQueue = [];
	},

	setActive: function(status) {
		this.active = status;
		if(status) {
			this.unreadMessage = 0;
			this.model.room.set({
				'unreadMessage': 0,
				'isActive': true
			});
		} else {
			this.model.room.set({
				'isActive': false
			});
		}
		//TODO: move it to view ???
		this.viewDiscussion.getTextInput().focus();
	},

	onKeypress: function(event) {
		if (this.active && event.which == 13 && !event.shiftKey) {
			var inputField = $(event.target),
				inputValue = inputField.val();

			event.preventDefault();

			// Prevent empty messages or messages with too many characters
			if (inputValue.length && inputValue.length <= this.maxCharacterLimit) {
				this.sendMessage(inputValue);
				inputField.val('').focus();
				$('body').removeClass('warn limit-near limit-reached');
			}
		}
	},

	sendMessage: function(text) {
		if(!text) {return;}

		var chatEntry = new models.ChatEntry({
			roomId: this.roomId,
			text: text
		});

		this.fire('sendMessage', chatEntry);
		//listeners may change the text on the chatEntry (evaluate commands) or blank it entirely
		//check to make sure we aren't unintentionally sending a blank line
		if(!chatEntry.text) {return;}

		// Private message
		if( !this.isMain() ) {
			if( this.afterInitQueue.length < 1 || this.model.users.length < 2 ){
				this.mainController.socket.send( this.model.privateRoom.xport() );
			}
			if( !this.isInitialized  ) {
				this.afterInitQueue.push(chatEntry.xport());
				//temp chat entry in case of slow connection time
				chatEntry.set({temp : true, avatarSrc: wgAvatarUrl });
				this.model.chats.add(chatEntry);
			} else {
				this.socket.send(chatEntry.xport());
			}
		} else {
			this.socket.send(chatEntry.xport());
		}
	},

	updateCharacterCount: function(event) {
		var inputField = $(event.target),
			inputValue = inputField.val(),
			currentLength = inputValue.length,
			remaining = this.maxCharacterLimit - currentLength;

		// display character count if nearing limit
		$('.remaining').text(remaining);
		$('body')
			.toggleClass('warn', remaining <= 200)
			.toggleClass('limit-near', remaining <= 100)
			.toggleClass('limit-reached', remaining <= 0);
	},

	onChatAdd: function(message) {
		var newChatEntry;
		var dataObj = JSON.parse(message.data);

		if(dataObj.attrs.isInlineAlert){
			newChatEntry = new models.InlineAlert();
		} else {
			newChatEntry = new models.ChatEntry();
		}


		newChatEntry.mport(message.data);

		this.model.chats.add(newChatEntry);
		if( this.model.chats.length > 1000 ){
			var first = this.model.chats.at(0);
			this.model.chats.remove(first);
		}
	},

	onCTCP: function(message) {
		var ctcpMessage = new models.CTCPMessage();
		ctcpMessage.mport(message.data);

		//All we're going to do with this is reply with 'Special:Chat' if type == version, nothing else has any meaning to us.
		if(ctcpMessage.get('type').toLowerCase() == 'version') {
			var ctcpReply = new models.CTCPMessage({
				target: ctcpMessage.get('sender'),
				data: {
					//Our version number isn't very important, but the version number of a bot might be very
					//important to other bots. Other bots can use this format to reply with a useful version
					//number, which our reply should match. In other words, this is future proof.
					client: 'Special:Chat',
					version: 0
				}
			});
		}
	},

	onJoin: function(message) {
		var joinedUser = new models.User();
		joinedUser.mport(message.data);

		if(joinedUser.get('name') == wgUserName) {
			this.userMain = joinedUser;
		}

		if(this.partTimeOuts[joinedUser.get('name')]) {
			clearTimeout(this.partTimeOuts[joinedUser.get('name')]);
			this.partTimeOuts[joinedUser.get('name')] = null;
			$().log('user rejoined clear partTimeOut');
		}

		var connectedUser = this.model.users.findByName(joinedUser.get('name'));

		if(typeof connectedUser == "undefined"){
			this.model.users.add(joinedUser);
			this.fire('afterJoin', joinedUser);

			//TODO: move it to other class
			if(this.isMain()) {
				if(joinedUser.get('name') != wgUserName) {
					// Create the inline-alert (on client side so that we only display it if the user actually IS new to the room and not just disconnecting/reconnecting).
					var newChatEntry = new models.InlineAlert({text: $.msg('chat-user-joined', this.sanitizeHtml(joinedUser.get('name')) ) });
					this.model.chats.add(newChatEntry);
				}
			}

			this.disableRoom(joinedUser, false);
		} else {
			// The user is already in the room... just update them (in case they have changed).
			this.model.users.remove(connectedUser);
			this.model.users.add(joinedUser);
		}
	},

	onPart: function(message) {
		var partedUser = new models.User();
		partedUser.mport(message.data);
		if(this.partTimeOuts[partedUser.get('name')]) {
			return true;
		}
		this.partTimeOuts[partedUser.get('name')] = setTimeout(this.proxy(function(){
			this.onPartBase(partedUser);
		}), 45000);
	},

	onLogout: function(message) {
		var logoutEvent = new models.LogoutEvent();
		logoutEvent.mport(message.data);
		this.onPartBase(logoutEvent.get('name'), false);
	},

	onMod: function(message) {
		var modEvent = new models.ModEvent();
		modEvent.mport(message.data);
		var newChatEntry = new models.InlineAlert({text: $.msg('chat-inlinealert-a-made-b-chatmod', this.sanitizeHTML(modEvent.get('performer')), this.sanitizeHTML(modEvent.get('target')) )});
		this.model.chats.add(newChatEntry);
	},

	onKick: function(message) {
		var kickEvent = new models.KickEvent();
		kickEvent.mport(message.data);

		this.onKickOrBan(kickEvent, 'kicked');
	},

	onBan: function(message) {
		var banEvent = new models.BanEvent();
		banEvent.mport(message.data);
		this.onKickOrBan(banEvent, 'banned');
		this.banned[banEvent.get('target')] = true;
	},

	onUnban: function(message) {
		var unbanEvent = new models.UnbanEvent();
		unbanEvent.mport(message.data);
		this.onKickOrBan(unbanEvent, 'unbanned');
		this.banned[unbanEvent.get('target')] = false;
	},

	onKickOrBan: function(kickEvent, mode) {
		if ( kickEvent.get('target') != wgUserName  ) {
			var undoLink = "";
			if(this.userMain.get('isModerator') && mode == 'banned' ) {
				undoLink = ' (<a href="#" data-type="ban-undo" data-user="' + this.sanitizeHtml(kickEvent.get('target')) + '" >' + $.msg('chat-ban-undolink') + '</a>)';
			}

			this.onPartBase(kickEvent.get('target'), true);
			var newChatEntry = new models.InlineAlert({text: $.msg('chat-user-was-' + mode, this.sanitizeHtml(kickEvent.get('target')), this.sanitizeHtml(kickEvent.get('performer')), undoLink ) });

			this.model.chats.add(newChatEntry);
		} else {
			var newChatEntry = new models.InlineAlert({ text: $.msg('chat-you-were-' + mode, this.sanitizeHtml(kickEvent.get('performer')) )});
			this.model.chats.add(newChatEntry);
			this.model.room.set({
				'blockedMessageInput': true
			});

			while(this.model.users.models[0] ) {
				this.model.users.remove( this.model.users.models[0] );
			}

			for(var i in this.chats.privates ) {
				/*	this.chats.privates[i].model.room.set({
					'blockedMessageInput': true
				});*/

				this.chats.privates[ i ].model.room.set({
					'hidden':  true
				});
			}

			this.setActive(true);
			this.viewDiscussion.updateRoom(this.model.room);
		}
	},

	onPartBase: function(partedUser, skipAlert) {
		if (typeof partedUser !== 'string') partedUser = partedUser.get('name');

		var connectedUser = this.model.users.findByName(partedUser);

		if(typeof connectedUser != "undefined"){

			//TODO: move it to other class
			if(this.isMain() && (connectedUser.get('name') != wgUserName) && (!skipAlert)) {
				var newChatEntry = new models.InlineAlert({text: $.msg('chat-user-parted', this.sanitizeHtml(connectedUser.get('name')) ) });
				this.model.chats.add(newChatEntry);
			}

			this.model.users.remove(connectedUser);
			this.disableRoom(connectedUser, true);
		}
	},

	//TODO: this is wrong place for this
	disableRoom: function(user, flag) {
		if( this.isMain() ) {
			//TODO: fix it for multiuser priv chat
			var privateUser =  this.model.privateUsers.findByName(user.get('name'));

			if(typeof privateUser != "undefined"){
				var roomId = privateUser.get('roomId');
				if( typeof( this.chats.privates[roomId] ) != "undefined" ){
					this.chats.privates[roomId].model.room.set({
						'blockedMessageInput': flag
					});
				}
				//try to reconnect
				if(flag === false && this.chats.privates[roomId].model.chats.length > 0) {
					this.socket.send( this.chats.privates[roomId].model.privateRoom.xport() );
				}
			}

		}
	},

	clickAnchor: function(event) {
		var target = $(event.target);
		if(target.attr('data-type') == 'ban-undo') {
			this.unban(target.attr('data-user'), $.msg('chat-log-reason-undo') );
			return true;
		}
		window.open(target.closest('a').attr("href"));
	},

	init: function() {
		this.socket.connect();
	}
});


var NodeChatController = $.createClass(NodeRoomController,{
	active: true,
	chats: {
		main: null,
		opens: {}, //to store more than one open chat in one window not supported yet (for now only one)
		privates: {}
	},
	activeRoom: null,
	constructor: function(roomId) {
		NodeChatController.superclass.constructor.apply(this,arguments);

		this.socket.bind('openPrivateRoom',  $.proxy(this.onOpenPrivateRoom, this));
		this.socket.bind('updateUser',  $.proxy(this.onUpdateUser, this));

		this.bind('afterJoin', $.proxy(this.afterJoin, this));
		this.viewUsers = new NodeChatUsers({model: this.model, el: $('body')});

		this.viewUsers.bind('showPrivateMessage', $.proxy(this.privateMessage, this) );
		this.viewUsers.bind('kick', $.proxy(this.kick, this) );
		this.viewUsers.bind('ban', $.proxy(this.ban, this) );
		this.viewUsers.bind('giveChatMod', $.proxy(this.giveChatMod, this) );


		this.viewUsers.bind('blockPrivateMessage', $.proxy(this.blockPrivate, this) );
		this.viewUsers.bind('allowPrivateMessage', $.proxy(this.allowPrivate, this) );

		this.viewUsers.bind('mainListClick', $.proxy(this.mainListClick, this) );
		this.viewUsers.bind('privateListClick', $.proxy(this.privateListClick, this) );

		this.viewUsers.bind('clickAnchor', $.proxy(this.clickAnchor, this) );

		this.viewUsers.render();
		this.viewDiscussion.show();

		// Handle Away status
		//TODO: move window to view ???
		$(window)
			.mousemove($.proxy(this.resetActivityTimer, this))
			.keypress($.proxy(this.resetActivityTimer, this))
			.focus($.proxy(this.resetActivityTimer, this));

		this.chats.main = this;
		return this;
	},

	afterJoin: function(newuser) {
		var privateUser = this.model.privateUsers.findByName(newuser.get('name'));

		if(typeof privateUser == "undefined"){
			return true;
		}

		if( typeof( this.chats.privates[ privateUser.get('roomId') ] ) != "undefined" ){
			this.chats.privates[ privateUser.get('roomId') ].model.room.set({
				'blockedMessageInput': false
			});
		}
	},

	menuHavePrivatBlock: function(name) {
		var user = this.model.blockedUsers.findByName(name);
		$().log(this.model.blockedUsers);
		if(typeof(user) == "undefined") {
			return true;
		}
		return false;
	},

	mainListClick: function(li) {
		var name = li.find('.username').first().text();
		var user = this.model.users.findByName(name);
		var userMain = this.model.users.findByName(wgUserName);
		var userYouAreBlockedBy = this.model.blockedByUsers.findByName(name);
		var userPrivate = this.model.privateUsers.findByName(name);

		var actions = {
			regular: ['profile', 'contribs'],
			admin: []
		};

		if(this.menuHavePrivatBlock(obj.name)) {
		//	actions.push( 'private-block' );

			if( typeof(userPrivate) == 'undefined' && typeof(userYouAreBlockedBy) == 'undefined' ) {
				actions.regular.push( 'private' );
			}
		} else {
			actions.regular.push( 'private-allow' );
		}

		if(this.userMain.get('isCanGiveChatMod') === true && user.get('isModerator') === false ){
			actions.admin.push('give-chat-mod');
		}

		if(this.userMain.get('isModerator') === true && user.get('isModerator') === false) {
			actions.admin.push('kick');
			actions.admin.push('ban');
		}

		if(this.userMain.get('isCanGiveChatMod') === true && user.get('isStaff') == false && $.inArray('kick', actions.admin) == -1) {
                        actions.admin.push('kick');
                        actions.admin.push('ban');
		}

		this.viewUsers.showMenu(li, actions);
	},

	privateListClick: function(li) {
		var name = li.find('.username').first().text();
		var user = this.model.privateUsers.findByName(name);

		var actions = { regular: ['profile', 'contribs'] };
		if(user.get('isStaff') === false) {
			actions.regular.push('private-block');
		}

		//, 'private-close'
		if(!this.privateMessage(name)) {
			this.viewUsers.showMenu(li, actions);
		}
	},

	showRoom: function(roomId) {
		$().log(roomId);
		if( this.activeRoom == roomId ) {
			return false;
		}

		this.activeRoom = roomId;
		if(roomId == 'main') {
			this.chats.main.setActive(true);
		} else {
			this.chats.main.setActive(false);
		}

		for(var i in this.chats.privates) {
			if(i == roomId) {
				this.chats.privates[i].setActive(true);
			} else {
				this.chats.privates[i].setActive(false);
			}
		}
		return true;
	},

	privateMessage: function(name) {
		var connectedUser = false;
		var userData;
		this.model.privateUsers.find(function(userEl){
			if(userEl.get('name') == name) {
				connectedUser = true;
				userData = userEl;
			}
		});

		if(connectedUser) {
			return this.showRoom(userData.get('roomId'))
		} else {
			this.openPrivateChat([name]);
			return true;
		}
	},

	openPrivateChat: function(users) {
		users.push( wgUserName );
		$.ajax({
			type: 'POST',
			url: wgScript + '?action=ajax&rs=ChatAjax&method=getPrivateRoomID',
			data: {
				users : users.join(',')
			},
			success: $.proxy(function(data) {
				$().log("Attempting create private room with users " + users.join(','));
				var data = new models.OpenPrivateRoom({roomId: data.id, users: users});
				this.fire('sendOpenPrivateRoom', data);
				if(!data.prevented) {
					this.baseOpenPrivateRoom(data, true);
					this.showRoom(data.get('roomId') );
					this.chats.privates[ data.get('roomId') ].init();
					//this.socket.send(data.xport());
				}
			}, this)
		});
		this.viewUsers.hideMenu();
	},


	blockAllowPrivateAjax: function(name, dir, callback) {
		$.ajax({
			type: 'POST',
			url: wgScript + '?action=ajax&rs=ChatAjax&method=blockOrBanChat',
			data: {
				userToBan : name,
				dir: dir
			},
			success: callback
		});
	},

	blockPrivate: function(name) {
		//FIXME: because this is not a command, it cannot be prevented
		this.fire('sendBlockPrivate', name);

		this.blockAllowPrivateAjax(name, 'add', $.proxy(function(data) {
			var user = this.model.privateUsers.findByName(name);
			var userClear = new models.User({'name': name});

			this.model.blockedUsers.add(userClear);
			if(typeof(user) != "undefined") {
				this.chats.privates[ user.get('roomId') ].model.room.set({
					'hidden':  true
				});

				var newChatEntry = new models.InlineAlert({text: $.msg( 'chat-user-blocked', wgUserName, this.sanitizeHtml(userClear.get('name')) ) });
				this.chats.privates[ user.get('roomId') ].socket.send(newChatEntry.xport());

				if(this.chats.privates[ user.get('roomId') ].active) {
					this.chats.privates[ user.get('roomId') ].setActive(false);
					this.setActive(true);
				}
			}
		}, this));

		//FIXME: this may cause problems if some script calls this function when the user has an unrelated user menu open
		this.viewUsers.hideMenu();
	},

	allowPrivate: function(name) {
		this.fire('sendAllowPrivate', name);

		this.blockAllowPrivateAjax(name, 'remove', $.proxy(function(data) {
			var privateUser = this.model.privateUsers.findByName(name);
			var user = this.model.blockedUsers.findByName(name);

			if(typeof(user) != "undefined") {
				this.model.blockedUsers.remove(user);
			}

			if(typeof(privateUser) != "undefined") {
				this.chats.privates[ privateUser.get('roomId') ].model.room.set({
					'hidden':  false
				});

				var newChatEntry = new models.InlineAlert({text: $.msg('chat-user-allow', wgUserName, this.sanitizeHtml(privateUser.get('name')) ) });
				this.chats.privates[ privateUser.get('roomId') ].socket.send(newChatEntry.xport());
			}
		}, this));

		this.viewUsers.hideMenu();
	},

	setStatus: function(state, message) {
		var setStatusCommand = new models.SetStatusCommand({
			statusState: state,
			statusMessage: message
		});
		this.fire('sendStatus', setStatusCommand);
		if(!setStatusCommand.prevented) {
			this.socket.send(setStatusCommand.xport());
		}
	},

	// Set the current user's status to 'away' and set an away message if provided.
	setAway: function(){
		var msg = '';
		$().log("Attempting to go away with message: " + msg);
		this.setStatus(STATUS_STATE_AWAY, msg);
	},

	// Set the user as being back from their "away" state (they are here again) and remove the status message.
	setBack: function(){
		if( ! this.comingBackFromAway){ // if we have sent this command (but just haven't finished coming back yet), don't keep spamming the server w/this command
			this.comingBackFromAway = true;
			$().log("Telling the server that I'm back.");
			this.setStatus(STATUS_STATE_BACK, '');
		}
	},

	startActivityTimer: function() {
		this.activityTimer = setTimeout($.proxy(this.setAway, this), 5 * 60 * 1000); // the first number is minutes.
	},

	resetActivityTimer: function() {
		clearTimeout(this.activityTimer);
		this.startActivityTimer();

		// If user had been set to away, ping server to unset away.
		if($('#ChatHeader .User').hasClass('away')){
			this.setBack();
		}
	},

	kick: function(name) {
		$().log("Attempting to kick user: " + name);
		var kickCommand = new models.KickCommand({userToKick: name});
		this.fire('sendKick', kickCommand);
		if(!kickCommand.prevented) {
			this.socket.send(kickCommand.xport());
		}

		this.viewUsers.hideMenu();
	},

	ban: function(name) {
		$().log("Attempting to ban user: " + name);

		this.viewUsers.hideMenu();
		var title = $.msg('chat-ban-modal-heading'),
			okCallback = function(expires, reason) {
				banCommand = new models.BanCommand({
					userToBan: name,
					time: expires,
					reason: reason
				});
				this.fire('sendBan', banCommand);
				if(!banCommand.prevented) {
					this.socket.send(banCommand.xport());
				}
			};

		var chatBanModal = new ChatBanModal(title, okCallback);
	},

	unban: function(name, reason) {
		if(this.banned[name]) {
			this.banned[name] = false;
			unbanCommand = new models.UnbanCommand({
				userToUnban: name,
				reason: reason
			});
			this.fire('sendUnban', unbanCommand);
			if(!unbanCommand.prevented) {
				this.socket.send(banCommand.xport());
			}
		} else {
			var newChatEntry = new models.InlineAlert({text: $.msg('chat-ban-cannt-undo') });
			this.model.chats.add(newChatEntry);
		}
	},

	giveChatMod: function(name) {
		$().log("Attempting to give chat mod to user: " + name);
		var giveChatModCommand = new models.GiveChatModCommand({userToPromote: name});
		this.fire('sendGiveChatMod', giveChatModCommand);
		if(!giveChatModCommand.prevented) {
			this.socket.send(giveChatModCommand.xport());
		}

		this.viewUsers.hideMenu();
	},

	onUpdateUser: function(message) {
		var updatedUser = new models.User();
		updatedUser.mport(message.data);

		var connectedUser = this.model.users.findByName(updatedUser.get('name'));

		if(typeof connectedUser != "undefined"){
			// Is this the right way to do it?
			this.model.users.remove(connectedUser);
			this.model.users.add(updatedUser);

			// If it was the current user who changed (and they are "back") set them as no longer in the process of comingBackFromAway.
			if((this.comingBackFromAway) && (connectedUser.get('name') == wgUserName) && (connectedUser.get('statusState') != STATUS_STATE_AWAY)){
				this.comingBackFromAway = false;
			}
		}
	},

	baseOpenPrivateRoom: function(data, active) {
		this.chats.privates[ data.get('roomId') ] = new NodeRoomController(data.get('roomId'));
		this.chats.privates[ data.get('roomId') ].mainController = this; //set main controller for this chat room
		this.chats.privates[ data.get('roomId') ].model.privateRoom =  data;
		var users = data.get('users');
		for( var i in users) {
			if( users[i] != wgUserName ) {
				var privateUser = new models.PrivateUser(this.model.users.findByName(users[i]).attributes);

				privateUser.set({
					'name' : users[i],
					'active': active,
					'roomId' : data.get('roomId')
				});

				this.model.privateUsers.add( privateUser );
				var roomData = { 'privateUser':  privateUser };

				//hide blocked room for case of allow

				this.chats.privates[ data.get('roomId') ].model.room.set(roomData);

				break;
			}
		}
	},

	onOpenPrivateRoom: function(message) {
		var room = new models.OpenPrivateRoom();
		room.mport(message.data);

		var users = room.get('users');
		for( var i = 0; i < users.length; i++ ) {
			if( users[i] != wgUserName ) {
				var blockedUser = this.model.blockedUsers.findByName( users[i] );
				if(typeof(blockedUser ) != 'undefined' && blockedUser.get('name') ==  users[i] ) {
					return ;
				}
			}
		}

		if( typeof( this.chats.privates[ room.get('roomId')  ] ) == 'undefined' ) {
			this.baseOpenPrivateRoom(room, false);
		}
		this.chats.privates[ room.get('roomId') ].init();
	},

	init: function() {
		if($.browser.msie && parseFloat(jQuery.browser.version) < 8 ) {
			var newChatEntry = new models.InlineAlert({text: $.msg( 'chat-browser-is-notsupported' ) });
			this.model.chats.add(newChatEntry);
			return true;
		}
		$.getMessages('Chat', $.proxy(function() {
			$.ajax({
				type: 'POST',
				url: wgScript + '?action=ajax&rs=ChatAjax&method=getListOfBlockedPrivate',
				success: $.proxy(function(data) {
					for( var i in data.blockedChatUsers ) {
						var userClear = new models.User({'name': data.blockedChatUsers[i] });
						this.model.blockedUsers.add(userClear);
					}

					for( var i in data.blockedByChatUsers ) {
						var userClear = new models.User({'name': data.blockedByChatUsers[i] });
						this.model.blockedByUsers.add(userClear);
					}
					this.socket.connect();
				}, this)
			});
		}, this));

		/*
		 * we cannot bind to unload, cos it's too late for sending the command - the socket is already closed...
		 */
		$(window).bind('beforeunload', $.proxy(function () {
			var logoutCommand = new models.LogoutCommand();
			this.socket.send(logoutCommand.xport());
		}, this));
	}
});

//
// Bootstrap the app
//
$(function() {
	if (typeof roomId !== "undefined") {
		window.mainRoom = new NodeChatController(roomId);
		window.mainRoom.init();
	}
});
