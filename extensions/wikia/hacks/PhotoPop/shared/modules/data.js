var exports = exports || {};

define.call(exports, {
	XDomainLoader: my.Class({
		constructor: function(){
			Observe(this);
		},
		
		load: function(url, options){
			this.fire('beforeLoad', {url: url});
			
			options = options || {};
			options.method = options.method || 'get';
			var that = this;
			
			if(typeof Titanium != 'undefined'){
				url = url + ((url.indexOf('?') >= 0) ? '&' : '?') + 'format=json';
				
				Titanium.App.addEventListener('XDomainLoader:error', function(event){
					that.fire('error', {url: url, error: event});
				});
				
				Titanium.App.addEventListener('XDomainLoader:success', function(event){
					that.fire('success', {url: url, response: event});
				});
				
				Titanium.App.fireEvent('XDomainLoader:load', {url: url, options: options});
			}else{
				url = url + ((url.indexOf('?') >= 0) ? '&' : '?') + 'callback=?';
				
				reqwest({
					url: url,
					type: 'jsonp',
					method: options.method || 'get',
					error: function(err){
						that.fire('error', {url: url, error: err});
					},
					success: function(data) {
						that.fire('success', {url: url, response: data});
					}
				});
			}
		}
	})
});