jQuery(function( $ ) {
	var $toolbar,
		$header = $( '#WikiHeader' ),
		$button = $header.find( '.share-button' );

	// Load all required assets for the SharingToolbar, then initialize it
	$button.one( 'click', function( event ) {
		$button.addClass('share-enabled');

		require(['wikia.loader'], function(loader) {
			loader({
				type: loader.MULTI,
				resources: {
					scripts: 'sharingtoolbar_js',
					templates: [{
						controller: 'SharingToolbarController',
						method: 'Index',
						params: {pagename: window.mw.config.get('wgPageName')}
					}]
				}
			},{
				type: loader.SCSS,
				resources: '/skins/oasis/css/core/SharingToolbar.scss',
				params: {
					widthType: window.wgOasisGrid ? 3 : 0
				}
			}).done(
				function( response ) {
					loader.processStyle( response.styles );
					loader.processScript( response.scripts );

					// Attach toolbar to DOM
					$toolbar = $( response.templates.SharingToolbarController_Index );
					$header.append( $toolbar.addClass('loading') );

					// Initialize the Sharing Toolbar
					Wikia.SharingToolbar.init({
						button: $button,
						event: event,
						toolbar: $toolbar
					});

					// Display the toolbar when the share buttons are done processing
					Wikia.ShareButtons.process().done(function() {
						Wikia.SharingToolbar.toggleToolbar( event );
					});
				}
			);
		})

	});
});