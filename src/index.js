import './index.pcss';

import { IconPlay } from '@codexteam/icons';
import Uploader from './uploader';
import { isEmpty, make, moveCaretToTheEnd } from './utils/dom';
import { getExtensionFromFileName } from './utils/file';

const LOADER_TIMEOUT = 500;

/**
 * @typedef {object} MediaToolData
 * @description Media Tool's output data format
 * @property {MediaFileData} file - object containing information about the file
 * @property {string} title - file's title
 */

/**
 * @typedef {object} MediaFileData
 * @description Media Tool's file format
 * @property {string} [url] - file's upload url
 * @property {string} [size] - file's size
 * @property {string} [extension] - file's extension
 * @property {string} [name] - file's name
 */

/**
 * @typedef {object} FileData
 * @description Media Tool's response from backend. Could contain any data.
 * @property {string} [url] - file's url
 * @property {string} [name] - file's name with extension
 * @property {string} [extension] - file's extension
 */

/**
 * @typedef {object} UploadResponseFormat
 * @description This format expected from backend on file upload
 * @property {number} success  - 1 for successful uploading, 0 for failure
 * @property {FileData} file - backend response with uploaded file data.
 */

/**
 * @typedef {object} MediaToolConfig
 * @description Config supported by Tool
 * @property {string} endpoint - file upload url
 * @property {string} field - field name for uploaded file
 * @property {string} types - available mime-types
 * @property {string} errorMessage - message to show if file uploading failed
 * @property {object} [uploader] - optional custom uploader
 * @property {function(File): Promise.<UploadResponseFormat>} [uploader.uploadByFile] - custom method that upload file and returns response
 */

/**
 * @typedef {object} EditorAPI
 * @property {object} styles - Styles API {@link https://github.com/codex-team/editor.js/blob/next/types/api/styles.d.ts}
 * @property {object} i18n - Internationalization API {@link https://github.com/codex-team/editor.js/blob/next/types/api/i18n.d.ts}
 * @property {object} notifier - Notifier API {@link https://github.com/codex-team/editor.js/blob/next/types/api/notifier.d.ts}
 */

/**
 * @class MediaTool
 * @classdesc MediaTool for Editor.js 2.0
 */
export default class MediaTool {
  /**
   * @param {object} options - tool constructor options
   * @param {MediaToolData} [options.data] - previously saved data
   * @param {MediaToolConfig} options.config - user defined config
   * @param {EditorAPI} options.api - Editor.js API
   * @param {boolean} options.readOnly - flag indicates whether the Read-Only mode enabled or not
   */
  constructor({ data, config, api, readOnly }) {
    this.api = api;
    this.readOnly = readOnly;

    this.nodes = {
      wrapper: null,
      button: null,
      title: null,
    };

    this._data = {
      file: {},
      title: '',
    };

    this.config = {
      endpoint: config.endpoint || '',
      field: config.field || 'file',
      // types: config.types || '*',
      types: config.types || 'video/*,audio/*',
      buttonText: config.buttonText || 'Select file to upload',
      errorMessage: config.errorMessage || 'File upload failed',
      uploader: config.uploader || undefined,
      additionalRequestHeaders: config.additionalRequestHeaders || {},
    };

    if (data !== undefined && !isEmpty(data)) {
      this.data = data;
    }

    /**
     * Module for files uploading
     */
    this.uploader = new Uploader({
      config: this.config,
      onUpload: (response) => this.onUpload(response),
      onError: (error) => this.uploadingFailed(error),
    });

    this.enableFileUpload = this.enableFileUpload.bind(this);
  }

  /**
   * Get Tool toolbox settings
   * icon - Tool icon's SVG
   * title - title to show in toolbox
   *
   * @returns {{icon: string, title: string}}
   */
  static get toolbox() {
    return {
      icon: IconPlay,
      title: 'Media',
    };
  }

  /**
   * Returns true to notify core that read-only is supported
   *
   * @returns {boolean}
   */
  static get isReadOnlySupported() {
    return true;
  }

  /**
   * Tool's CSS classes
   *
   * @returns {object}
   */
  get CSS() {
    return {
      baseClass: this.api.styles.block,
      apiButton: this.api.styles.button,
      loader: this.api.styles.loader,
      /**
       * Tool's classes
       */
      wrapper: 'cdx-media',
      wrapperWithFile: 'cdx-media--with-file',
      wrapperLoading: 'cdx-media--loading',
      button: 'cdx-media__button',
      title: 'cdx-media__title',
      size: 'cdx-media__size',
      downloadButton: 'cdx-media__download-button',
      fileInfo: 'cdx-media__file-info',
      fileIcon: 'cdx-media__file-icon',
      fileIconBackground: 'cdx-media__file-icon-background',
      fileIconLabel: 'cdx-media__file-icon-label',
    };
  }

  /**
   * Possible files' extension colors
   *
   * @returns {object}
   */
  get EXTENSIONS() {
    return {
      mp3: '#eab456',
      ogg: '#eab456',
      wav: '#eab456',
      mp4: '#f676a6',
      avi: '#f676a6',
      mov: '#f676a6',
      webm: '#f676a6',
    };
  }

  /**
   * Validate block data:
   * - check for emptiness
   *
   * @param {MediaToolData} savedData — data received after saving
   * @returns {boolean} false if saved data is not correct, otherwise true
   * @public
   */
  validate(savedData) {
    if (isEmpty(savedData.file)) {
      return false;
    }

    return true;
  }

  /**
   * Return Block data
   *
   * @param {HTMLElement} toolsContent - block main element returned by the render method
   * @returns {MediaToolData}
   */
  save(toolsContent) {
    /**
     * If file was uploaded
     */
    if (this.pluginHasData()) {
      const titleElement = toolsContent.querySelector(`.${this.CSS.title}`);

      if (titleElement) {
        Object.assign(this.data, {
          title: titleElement.innerHTML,
        });
      }
    }

    return this.data;
  }

  /**
   * Renders Block content
   *
   * @returns {HTMLDivElement}
   */
  render() {
    const holder = make('div', this.CSS.baseClass);

    this.nodes.wrapper = make('div', this.CSS.wrapper);

    if (this.pluginHasData()) {
      this.showFileData();
    } else {
      this.prepareUploadButton();
    }

    holder.appendChild(this.nodes.wrapper);

    return holder;
  }

  /**
   * Prepares button for file uploading
   */
  prepareUploadButton() {
    this.nodes.button = make('div', [this.CSS.apiButton, this.CSS.button]);
    this.nodes.button.innerHTML = `${IconPlay} ${this.config.buttonText}`;

    if (!this.readOnly) {
      this.nodes.button.addEventListener('click', this.enableFileUpload);
    }

    this.nodes.wrapper.appendChild(this.nodes.button);
  }

  /**
   * Fires after clicks on the Toolbox MediaTool Icon
   * Initiates click on the Select File button
   *
   * @public
   */
  appendCallback() {
    this.nodes.button.click();
  }

  /**
   * Checks if any of Tool's fields have data
   *
   * @returns {boolean}
   */
  pluginHasData() {
    return this.data.title !== '' || Object.values(this.data.file).some(item => item !== undefined);
  }

  /**
   * Allow to upload files on button click
   */
  enableFileUpload() {
    this.uploader.uploadSelectedFile({
      onPreview: () => {
        this.nodes.wrapper.classList.add(this.CSS.wrapperLoading, this.CSS.loader);
      },
    });
  }

  /**
   * File uploading callback
   *
   * @param {UploadResponseFormat} response - server returned data
   */
  onUpload(response) {
    const body = response;

    try {
      if (body.success && body.file !== undefined && !isEmpty(body.file)) {
        this.data = {
          file: body.file,
          title: body.file.title || '',
        };

        this.nodes.button.remove();
        this.showFileData();

        moveCaretToTheEnd(this.nodes.title);

        this.removeLoader();
      } else {
        this.uploadingFailed(this.config.errorMessage);
      }
    } catch (error) {
      console.error('Media tool error:', error);
      this.uploadingFailed(this.config.errorMessage);
    }

    /**
     * Trigger onChange function when upload finished
     */
    this.api.blocks.getBlockByIndex(this.api.blocks.getCurrentBlockIndex()).dispatchChange();
  }

  /**
   * Handles uploaded file's extension and appends corresponding icon
   *
   * @param {object<string, string | number | boolean>} file - uploaded file data got from the backend. Could contain any fields.
   */
  appendFileIcon(file) {
    const extensionProvided = file.extension;
    const extension = extensionProvided || getExtensionFromFileName(file.name);
    const extensionColor = this.EXTENSIONS[extension];
    const extensionMaxLen = 4;

    const wrapper = make('div', this.CSS.fileIcon);
    const background = make('div', this.CSS.fileIconBackground);

    if (extensionColor) {
      background.style.backgroundColor = extensionColor;
    }

    wrapper.appendChild(background);

    /**
     * If extension exists, add it via a separate element
     * Otherwise, append file icon
     */
    if (extension) {
      /**
       * Trim long extensions
       *  'sketch' -> 'sket…'
       */
      let extensionVisible = extension;

      if (extension.length > extensionMaxLen) {
        extensionVisible = extension.substring(0, extensionMaxLen) + '…';
      }

      const extensionLabel = make('div', this.CSS.fileIconLabel, {
        textContent: extensionVisible, // trimmed
        title: extension, // full text for hover
      });

      if (extensionColor) {
        extensionLabel.style.backgroundColor = extensionColor;
      }

      wrapper.appendChild(extensionLabel);
    } else {
      background.innerHTML = IconPlay;
    }

    this.nodes.wrapper.appendChild(wrapper);
  }

  /**
   * Removes tool's loader
   */
  removeLoader() {
    setTimeout(() => this.nodes.wrapper.classList.remove(this.CSS.wrapperLoading, this.CSS.loader), LOADER_TIMEOUT);
  }

  /**
   * If upload is successful, show info about the file
   */
  showFileData() {
    this.nodes.wrapper.classList.add(this.CSS.wrapperWithFile);
    const { file } = this.data;
    const extensionProvided = file.extension;
    const extension = extensionProvided || getExtensionFromFileName(file.name);

    if (['mp3', 'ogg', 'wav'].includes(extension)) {
      const audio = make('audio', 'audio', {
        controls: true,
        src: file.url,
      });

      audio.style.width = '100%';

      this.nodes.wrapper.appendChild(audio);
    } else if (['mp4', 'avi', 'mov', 'webm'].includes(extension)) {
      const video = make('video', 'video', {
        controls: true,
        src: file.url,
      });

      video.style.width = '100%';

      this.nodes.wrapper.appendChild(video);
    }
  }

  /**
   * If file uploading failed, remove loader and show notification
   *
   * @param {string} errorMessage -  error message
   */
  uploadingFailed(errorMessage) {
    this.api.notifier.show({
      message: errorMessage,
      style: 'error',
    });

    this.removeLoader();
  }

  /**
   * Return Media Tool's data
   *
   * @returns {MediaToolData}
   */
  get data() {
    return this._data;
  }

  /**
   * Stores all Tool's data
   *
   * @param {MediaToolData} data - data to set
   */
  set data({ file, title }) {
    this._data = {
      file,
      title,
    };
  }
}
